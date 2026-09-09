import { randomUUID } from 'node:crypto';
import {
  intentInterpretationSchema,
  searchCriteriaSchema,
  type IntentConfidence,
  type IntentInterpretation,
  type SearchCriteria
} from '@realty/core';
import { z } from 'zod';

export type IntentInterpreter = {
  interpret(intent: string): Promise<IntentInterpretation>;
};

export type OpenAIInterpreterOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export type ResilientInterpreterOptions = {
  primary?: IntentInterpreter;
  fallback?: IntentInterpreter;
  onFallback?: (context: { reason: 'provider_unavailable' | 'provider_invalid_response'; error: unknown }) => void;
};

const interpretationInputSchema = z.string().trim().min(5).max(2000);
export const INTENT_PROMPT_VERSION = 'intent-es-ar-v1';

const structuredInterpretationSchema = z.object({
  operation: z.enum(['sale', 'rent']).nullable(),
  locations: z.array(z.string().trim().min(1).max(120)).max(5),
  currency: z.enum(['ARS', 'USD']).nullable(),
  minPrice: z.number().nonnegative().nullable(),
  maxPrice: z.number().nonnegative().nullable(),
  minAreaM2: z.number().nonnegative().nullable(),
  bedrooms: z.number().int().nonnegative().nullable(),
  rooms: z.number().int().nonnegative().nullable(),
  excludedFloors: z.array(z.string().trim().min(1).max(80)).max(10),
  preferences: z.array(z.string().trim().min(1).max(120)).max(20),
  confidence: z.enum(['high', 'medium', 'low']),
  assumptions: z.array(z.string().trim().min(1).max(240)).max(10),
  evidence: z.array(z.object({
    input: z.string().trim().min(1).max(160),
    interpretedAs: z.string().trim().min(1).max(240)
  }).strict()).max(20)
}).strict();

const outputJsonSchema = {
  type: 'object',
  properties: {
    operation: { type: ['string', 'null'], enum: ['sale', 'rent', null] },
    locations: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    currency: { type: ['string', 'null'], enum: ['ARS', 'USD', null] },
    minPrice: { type: ['number', 'null'], minimum: 0 },
    maxPrice: { type: ['number', 'null'], minimum: 0 },
    minAreaM2: { type: ['number', 'null'], minimum: 0 },
    bedrooms: { type: ['integer', 'null'], minimum: 0 },
    rooms: { type: ['integer', 'null'], minimum: 0 },
    excludedFloors: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    preferences: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    assumptions: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    evidence: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          input: { type: 'string' },
          interpretedAs: { type: 'string' }
        },
        required: ['input', 'interpretedAs'],
        additionalProperties: false
      }
    }
  },
  required: [
    'operation', 'locations', 'currency', 'minPrice', 'maxPrice', 'minAreaM2',
    'bedrooms', 'rooms', 'excludedFloors', 'preferences', 'confidence', 'assumptions', 'evidence'
  ],
  additionalProperties: false
} as const;

const placeNames = [
  'Mar del Plata', 'Buenos Aires', 'Nueva Córdoba', 'Villa Crespo', 'Colegiales',
  'Palermo', 'Belgrano', 'Recoleta', 'Caballito', 'Núñez', 'Almagro', 'Pichincha',
  'Güemes', 'Córdoba', 'Rosario', 'Mendoza'
];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function parseLocalizedNumber(raw: string, scaleWord?: string): number | undefined {
  const compact = raw.replace(/\s/g, '').replace(/[.,]+$/, '');
  let value: number;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(compact)) {
    value = Number(compact.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(compact)) {
    value = Number(compact.replace(/,/g, ''));
  } else {
    value = Number(compact.replace(',', '.'));
  }
  if (!Number.isFinite(value)) return undefined;
  const scale = scaleWord?.startsWith('mill') ? 1_000_000 : scaleWord?.startsWith('mil') ? 1_000 : 1;
  return Math.round(value * scale);
}

function priceFromIntent(normalized: string): { value?: number; evidence?: string } {
  const match = normalized.match(
    /(?:hasta|maximo|max|menos de|tope(?: de)?)[^\d]{0,14}(\d[\d.,]*)(?:\s*(mil|millon(?:es)?))?/
  ) ?? normalized.match(/(?:usd|u\$s|ars|\$)\s*(\d[\d.,]*)(?:\s*(mil|millon(?:es)?))?/);
  if (!match?.[1]) return {};
  return { value: parseLocalizedNumber(match[1], match[2]), evidence: match[0] };
}

function areaFromIntent(normalized: string): { value?: number; evidence?: string } {
  const match = normalized.match(/(?:desde|minimo|min|mas de|al menos)\s*(\d+(?:[.,]\d+)?)\s*m(?:2|²)/);
  if (!match?.[1]) return {};
  return { value: parseLocalizedNumber(match[1]), evidence: match[0] };
}

function confidenceFor(criteria: SearchCriteria, assumptions: string[]): IntentConfidence {
  const decisiveFields = [criteria.locations?.length, criteria.maxPrice, criteria.rooms ?? criteria.bedrooms]
    .filter(Boolean).length;
  if (decisiveFields >= 3 && assumptions.length === 0) return 'high';
  if (decisiveFields >= 2) return 'medium';
  return 'low';
}

export class DeterministicIntentInterpreter implements IntentInterpreter {
  async interpret(rawIntent: string): Promise<IntentInterpretation> {
    const intent = interpretationInputSchema.parse(rawIntent);
    const normalized = normalize(intent);
    const locations = unique(placeNames.filter((place) => normalized.includes(normalize(place))));
    if (/\b(?:caba|capital federal)\b/.test(normalized)) locations.push('Buenos Aires');

    let operation: SearchCriteria['operation'];
    if (/\b(?:alquil|alquiler|renta)\w*/.test(normalized)) operation = 'rent';
    else if (/\b(?:compr|venta|adquir)\w*/.test(normalized)) operation = 'sale';

    let currency: SearchCriteria['currency'];
    if (/\b(?:ars|pesos?)\b/.test(normalized)) currency = 'ARS';
    else if (/\b(?:usd|dolares?|u\$s)\b/.test(normalized)) currency = 'USD';

    const roomsMatch = normalized.match(/(\d+)\s*(?:ambientes?|amb\.?)/);
    const bedroomsMatch = normalized.match(/(\d+)\s*(?:dormitorios?|habitaciones?)/);
    const price = priceFromIntent(normalized);
    const area = areaFromIntent(normalized);
    const excludedFloors = /(?:sin|no)\s+(?:planta baja|pb)\b/.test(normalized) ? ['Planta baja'] : [];
    const preferencePatterns: Array<[RegExp, string]> = [
      [/\bbalcon\b/, 'Balcón'],
      [/\bluminos\w*/, 'Luminoso'],
      [/\b(?:silenc\w*|tranquil\w*)/, 'Calle tranquila'],
      [/\b(?:cochera|garage)\b/, 'Cochera'],
      [/\bpatio\b/, 'Patio'],
      [/\bterraza\b/, 'Terraza'],
      [/\b(?:pileta|piscina)\b/, 'Pileta'],
      [/\b(?:apto mascotas|pet friendly)\b/, 'Apto mascotas']
    ];
    const preferences = preferencePatterns.filter(([pattern]) => pattern.test(normalized)).map(([, label]) => label);
    const assumptions: string[] = [];
    if (!operation) assumptions.push('No se indicó la operación; confirmá si querés comprar o alquilar.');
    if (!currency && price.value !== undefined) assumptions.push('Se detectó un monto sin moneda; confirmá si es ARS o USD.');
    if (!locations.length) assumptions.push('No se reconoció una zona de los cinco mercados iniciales.');

    const evidence: IntentInterpretation['evidence'] = [];
    if (operation) evidence.push({ input: operation === 'rent' ? 'alquiler' : 'compra o venta', interpretedAs: operation === 'rent' ? 'Alquilar' : 'Comprar' });
    if (locations.length) evidence.push({ input: locations.join(', '), interpretedAs: `Zonas: ${locations.join(', ')}` });
    if (currency) evidence.push({ input: currency, interpretedAs: `Moneda: ${currency}` });
    if (price.value !== undefined) evidence.push({ input: price.evidence ?? String(price.value), interpretedAs: `Precio máximo: ${price.value}` });
    if (roomsMatch?.[1]) evidence.push({ input: roomsMatch[0], interpretedAs: `${roomsMatch[1]} ambientes o más` });
    if (bedroomsMatch?.[1]) evidence.push({ input: bedroomsMatch[0], interpretedAs: `${bedroomsMatch[1]} dormitorios o más` });
    if (area.value !== undefined) evidence.push({ input: area.evidence ?? String(area.value), interpretedAs: `${area.value} m² o más` });
    if (excludedFloors.length) evidence.push({ input: 'sin planta baja', interpretedAs: 'Excluir planta baja' });
    for (const preference of preferences) evidence.push({ input: preference, interpretedAs: `Preferencia: ${preference}` });

    const criteria = searchCriteriaSchema.parse({
      operation,
      locations: locations.length ? unique(locations).slice(0, 5) : undefined,
      currency,
      maxPrice: price.value,
      minAreaM2: area.value,
      rooms: roomsMatch?.[1] ? Number(roomsMatch[1]) : undefined,
      bedrooms: bedroomsMatch?.[1] ? Number(bedroomsMatch[1]) : undefined,
      excludedFloors: excludedFloors.length ? excludedFloors : undefined,
      preferences
    });

    return intentInterpretationSchema.parse({
      criteria,
      confidence: confidenceFor(criteria, assumptions),
      assumptions,
      evidence,
      provider: 'deterministic',
      promptVersion: INTENT_PROMPT_VERSION,
      requiresConfirmation: true
    });
  }
}

function criteriaFromStructured(value: z.infer<typeof structuredInterpretationSchema>): SearchCriteria {
  const compact = <T>(candidate: T | null): T | undefined => candidate === null ? undefined : candidate;
  return searchCriteriaSchema.parse({
    operation: compact(value.operation),
    locations: value.locations.length ? value.locations : undefined,
    currency: compact(value.currency),
    minPrice: compact(value.minPrice),
    maxPrice: compact(value.maxPrice),
    minAreaM2: compact(value.minAreaM2),
    bedrooms: compact(value.bedrooms),
    rooms: compact(value.rooms),
    excludedFloors: value.excludedFloors.length ? value.excludedFloors : undefined,
    preferences: value.preferences
  });
}

export class OpenAIIntentInterpreter implements IntentInterpreter {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: OpenAIInterpreterOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async interpret(rawIntent: string): Promise<IntentInterpretation> {
    const intent = interpretationInputSchema.parse(rawIntent);
    const clientRequestId = randomUUID();
    const response = await this.#fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        'content-type': 'application/json',
        'x-client-request-id': clientRequestId
      },
      signal: AbortSignal.timeout(this.#timeoutMs),
      body: JSON.stringify({
        model: this.#model,
        store: false,
        max_output_tokens: 900,
        input: [
          {
            role: 'system',
            content: 'Interpretá búsquedas inmobiliarias en español de Argentina. Extraé sólo lo explícito, no inventes ubicaciones, montos ni atributos. ARS significa pesos argentinos y USD dólares. En Argentina, ambientes y dormitorios son conceptos distintos. Registrá toda inferencia en assumptions. El usuario siempre confirmará los criterios antes de crear un monitor.'
          },
          { role: 'user', content: intent }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'real_estate_search_intent',
            description: 'Criterios editables extraídos de una búsqueda inmobiliaria argentina.',
            schema: outputJsonSchema,
            strict: true
          },
          verbosity: 'low'
        }
      })
    });

    const requestId = response.headers.get('x-request-id') ?? undefined;
    if (!response.ok) {
      throw new Error(`OpenAI Responses API failed with status ${response.status}${requestId ? ` (${requestId})` : ''}`);
    }
    const body = await response.json() as {
      status?: string;
      incomplete_details?: { reason?: string };
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
    };
    if (body.status === 'incomplete') {
      throw new Error(`OpenAI response was incomplete: ${body.incomplete_details?.reason ?? 'unknown'}`);
    }
    const content = body.output?.find((item) => item.type === 'message')?.content?.[0];
    if (content?.type === 'refusal') throw new Error('OpenAI declined to interpret the request');
    if (content?.type !== 'output_text' || !content.text) throw new Error('OpenAI returned no structured output');

    const structured = structuredInterpretationSchema.parse(JSON.parse(content.text));
    return intentInterpretationSchema.parse({
      criteria: criteriaFromStructured(structured),
      confidence: structured.confidence,
      assumptions: structured.assumptions,
      evidence: structured.evidence,
      provider: 'openai',
      model: this.#model,
      requestId,
      promptVersion: INTENT_PROMPT_VERSION,
      requiresConfirmation: true
    });
  }
}

function fallbackReason(error: unknown): 'provider_unavailable' | 'provider_invalid_response' {
  return error instanceof z.ZodError || error instanceof SyntaxError
    ? 'provider_invalid_response'
    : 'provider_unavailable';
}

export function createResilientIntentInterpreter(options: ResilientInterpreterOptions = {}): IntentInterpreter {
  const fallback = options.fallback ?? new DeterministicIntentInterpreter();
  if (!options.primary) return fallback;
  return {
    async interpret(intent) {
      try {
        return await options.primary!.interpret(intent);
      } catch (error) {
        const reason = fallbackReason(error);
        options.onFallback?.({ reason, error });
        const interpretation = await fallback.interpret(intent);
        return intentInterpretationSchema.parse({ ...interpretation, fallbackReason: reason });
      }
    }
  };
}
