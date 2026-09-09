import { randomUUID } from 'node:crypto';
import { propertyAnswerSchema, type PropertyAnswer } from '@realty/core';
import { z } from 'zod';

export const PROPERTY_ASSISTANT_PROMPT_VERSION = 'property-qa-es-ar-v1';

export type PropertyAssistantContext = {
  id: string;
  address: string | null;
  price: number | null;
  currency: string | null;
  areaTotalM2: number | null;
  rooms: number | null;
  bedrooms: number | null;
  floor: string | null;
  freshness: string;
  publications: Array<{
    sourceName: string;
    publisherType: string;
    publisherName: string | null;
    price: number | null;
    currency: string | null;
    status: string;
    lastVerifiedAt: string | null;
  }>;
};

export type PropertyAssistant = {
  answer(question: string, context: PropertyAssistantContext): Promise<PropertyAnswer>;
};

const questionSchema = z.string().trim().min(3).max(1000);
const answerContentSchema = z.object({
  answer: z.string().trim().min(1).max(2000),
  evidence: z.array(z.object({
    label: z.string().trim().min(1).max(100),
    value: z.string().trim().min(1).max(240),
    source: z.enum(['canonical_property', 'source_publication'])
  }).strict()).max(12),
  caveats: z.array(z.string().trim().min(1).max(300)).max(8)
}).strict();

const answerJsonSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    evidence: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' }, value: { type: 'string' },
          source: { type: 'string', enum: ['canonical_property', 'source_publication'] }
        },
        required: ['label', 'value', 'source'], additionalProperties: false
      }
    },
    caveats: { type: 'array', items: { type: 'string' }, maxItems: 8 }
  },
  required: ['answer', 'evidence', 'caveats'],
  additionalProperties: false
} as const;

function money(amount: number | null, currency: string | null): string {
  if (amount === null || !currency) return 'no informado';
  return `${currency} ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amount)}`;
}

export class DeterministicPropertyAssistant implements PropertyAssistant {
  async answer(rawQuestion: string, context: PropertyAssistantContext): Promise<PropertyAnswer> {
    const question = questionSchema.parse(rawQuestion);
    const normalized = question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const evidence: PropertyAnswer['evidence'] = [];
    const caveats: string[] = [];
    let answer: string;

    if (/m2|m²|metro cuadrado|precio por/.test(normalized)) {
      if (context.price !== null && context.areaTotalM2) {
        const perM2 = Math.round(context.price / context.areaTotalM2);
        answer = `El precio publicado equivale aproximadamente a ${money(perM2, context.currency)} por m² total.`;
        evidence.push({ label: 'Precio', value: money(context.price, context.currency), source: 'canonical_property' });
        evidence.push({ label: 'Superficie total', value: `${context.areaTotalM2} m²`, source: 'canonical_property' });
        caveats.push('El cálculo usa superficie total, no cubierta, y no incluye gastos de operación.');
      } else {
        answer = 'No hay suficiente información para calcular un precio por m² confiable.';
        caveats.push('Se necesitan precio, moneda y superficie total.');
      }
    } else if (/fuente|publica|dueno|dueño|inmobiliaria|operador/.test(normalized)) {
      const active = context.publications.filter((publication) => publication.status === 'active');
      answer = `Hay ${active.length} ${active.length === 1 ? 'publicación activa' : 'publicaciones activas'} vinculadas a esta propiedad.`;
      for (const publication of active.slice(0, 6)) {
        evidence.push({
          label: publication.sourceName,
          value: `${publication.publisherName ?? publication.publisherType} · ${money(publication.price, publication.currency)}`,
          source: 'source_publication'
        });
      }
    } else if (/disponib|vigente|verific|fresc/.test(normalized)) {
      answer = context.freshness === 'verified_today'
        ? 'La oportunidad tiene evidencia verificada hoy.'
        : 'La disponibilidad necesita confirmación con la publicación de origen.';
      evidence.push({ label: 'Frescura', value: context.freshness, source: 'canonical_property' });
      caveats.push('La verificación de una fuente no reemplaza la confirmación directa antes de reservar o pagar.');
    } else {
      answer = `La ficha registra ${context.rooms ?? 'sin dato de'} ambientes, ${context.areaTotalM2 ?? 'sin dato de'} m² totales y un precio de ${money(context.price, context.currency)}.`;
      if (context.address) evidence.push({ label: 'Ubicación publicada', value: context.address, source: 'canonical_property' });
      if (context.rooms !== null) evidence.push({ label: 'Ambientes', value: String(context.rooms), source: 'canonical_property' });
      if (context.areaTotalM2 !== null) evidence.push({ label: 'Superficie total', value: `${context.areaTotalM2} m²`, source: 'canonical_property' });
      caveats.push('No tenemos evidencia suficiente sobre estado, ruido, luz natural ni gastos si no figuran en las publicaciones.');
    }

    return propertyAnswerSchema.parse({
      answer, evidence, caveats, provider: 'deterministic', promptVersion: PROPERTY_ASSISTANT_PROMPT_VERSION
    });
  }
}

export class OpenAIPropertyAssistant implements PropertyAssistant {
  constructor(private readonly options: { apiKey: string; model: string; timeoutMs?: number; fetch?: typeof globalThis.fetch }) {}

  async answer(rawQuestion: string, context: PropertyAssistantContext): Promise<PropertyAnswer> {
    const question = questionSchema.parse(rawQuestion);
    const clientRequestId = randomUUID();
    const response = await (this.options.fetch ?? globalThis.fetch)('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
        'x-client-request-id': clientRequestId
      },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
      body: JSON.stringify({
        model: this.options.model,
        store: false,
        max_output_tokens: 900,
        input: [
          {
            role: 'system',
            content: 'Respondé en español de Argentina usando exclusivamente el contexto inmobiliario provisto. No inventes atributos, disponibilidad, barrio, costos ni conclusiones legales. Citá evidencia estructurada y explicitá incertidumbre.'
          },
          { role: 'user', content: JSON.stringify({ question, property: context }) }
        ],
        text: {
          format: {
            type: 'json_schema', name: 'property_answer', schema: answerJsonSchema, strict: true,
            description: 'Respuesta inmobiliaria fundamentada en la ficha y sus publicaciones.'
          },
          verbosity: 'low'
        }
      })
    });
    const requestId = response.headers.get('x-request-id') ?? undefined;
    if (!response.ok) throw new Error(`OpenAI Responses API failed with status ${response.status}${requestId ? ` (${requestId})` : ''}`);
    const body = await response.json() as {
      status?: string;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    if (body.status === 'incomplete') throw new Error('OpenAI response was incomplete');
    const content = body.output?.find((item) => item.type === 'message')?.content?.[0];
    if (content?.type !== 'output_text' || !content.text) throw new Error('OpenAI returned no structured output');
    const parsed = answerContentSchema.parse(JSON.parse(content.text));
    return propertyAnswerSchema.parse({
      ...parsed, provider: 'openai', model: this.options.model, requestId,
      promptVersion: PROPERTY_ASSISTANT_PROMPT_VERSION
    });
  }
}

export function createResilientPropertyAssistant(options: {
  primary?: PropertyAssistant;
  fallback?: PropertyAssistant;
  onFallback?: (context: { reason: 'provider_unavailable' | 'provider_invalid_response'; error: unknown }) => void;
} = {}): PropertyAssistant {
  const fallback = options.fallback ?? new DeterministicPropertyAssistant();
  if (!options.primary) return fallback;
  return {
    async answer(question, context) {
      try {
        return await options.primary!.answer(question, context);
      } catch (error) {
        const reason = error instanceof z.ZodError || error instanceof SyntaxError
          ? 'provider_invalid_response' as const
          : 'provider_unavailable' as const;
        options.onFallback?.({ reason, error });
        return propertyAnswerSchema.parse({ ...(await fallback.answer(question, context)), fallbackReason: reason });
      }
    }
  };
}
