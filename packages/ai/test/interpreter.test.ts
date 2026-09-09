import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createResilientIntentInterpreter,
  DeterministicIntentInterpreter,
  OpenAIIntentInterpreter
} from '../src/index.js';

describe('deterministic intent interpretation', () => {
  const interpreter = new DeterministicIntentInterpreter();

  const cases = [
    {
      text: 'Departamento de 3 ambientes en Palermo o Colegiales, hasta USD 250.000. Con balcón y sin planta baja.',
      criteria: { operation: undefined, locations: ['Colegiales', 'Palermo'], currency: 'USD', maxPrice: 250_000, rooms: 3, excludedFloors: ['Planta baja'], preferences: ['Balcón'] }
    },
    {
      text: 'Quiero alquilar en Nueva Córdoba, 2 dormitorios, máximo ARS 1.200.000 y cochera',
      criteria: { operation: 'rent', locations: ['Nueva Córdoba', 'Córdoba'], currency: 'ARS', maxPrice: 1_200_000, bedrooms: 2, preferences: ['Cochera'] }
    },
    {
      text: 'Comprar en Rosario con al menos 80 m², luminoso y terraza',
      criteria: { operation: 'sale', locations: ['Rosario'], minAreaM2: 80, preferences: ['Luminoso', 'Terraza'] }
    },
    {
      text: 'Casa en Mendoza hasta 300 mil dólares, con patio',
      criteria: { locations: ['Mendoza'], currency: 'USD', maxPrice: 300_000, preferences: ['Patio'] }
    },
    {
      text: 'Alquiler en Mar del Plata por menos de 900000 pesos, apto mascotas',
      criteria: { operation: 'rent', locations: ['Mar del Plata'], currency: 'ARS', maxPrice: 900_000, preferences: ['Apto mascotas'] }
    }
  ] as const;

  for (const scenario of cases) {
    it(`extracts: ${scenario.text}`, async () => {
      const result = await interpreter.interpret(scenario.text);
      for (const [key, expected] of Object.entries(scenario.criteria)) {
        assert.deepEqual(result.criteria[key as keyof typeof result.criteria], expected);
      }
      assert.equal(result.provider, 'deterministic');
      assert.equal(result.requiresConfirmation, true);
    });
  }

  it('does not silently invent hard constraints', async () => {
    const result = await interpreter.interpret('Busco algo lindo, tranquilo y con pileta');
    assert.equal(result.criteria.operation, undefined);
    assert.equal(result.criteria.currency, undefined);
    assert.equal(result.criteria.maxPrice, undefined);
    assert.deepEqual(result.criteria.preferences, ['Calle tranquila', 'Pileta']);
    assert.equal(result.confidence, 'low');
    assert.ok(result.assumptions.length >= 2);
  });
});

describe('OpenAI intent interpretation', () => {
  it('uses strict structured output and retains provider request metadata', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchStub: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{
          type: 'output_text',
          text: JSON.stringify({
            operation: 'sale', locations: ['Palermo'], currency: 'USD', minPrice: null,
            maxPrice: 250000, minAreaM2: null, bedrooms: null, rooms: 3,
            excludedFloors: [], preferences: ['Balcón'], confidence: 'high', assumptions: [],
            evidence: [{ input: '3 ambientes', interpretedAs: '3 ambientes o más' }]
          })
        }] }]
      }), { status: 200, headers: { 'x-request-id': 'req_test_123' } });
    };
    const interpreter = new OpenAIIntentInterpreter({ apiKey: 'test-key', model: 'gpt-test', fetch: fetchStub });
    const result = await interpreter.interpret('Comprar 3 ambientes en Palermo hasta USD 250.000 con balcón');

    assert.equal(result.provider, 'openai');
    assert.equal(result.requestId, 'req_test_123');
    assert.equal(result.criteria.maxPrice, 250000);
    const format = ((requestBody?.text as { format?: { type?: string; strict?: boolean } })?.format);
    assert.equal(format?.type, 'json_schema');
    assert.equal(format?.strict, true);
    assert.equal(requestBody?.store, false);
  });

  it('falls back deterministically when the provider is unavailable', async () => {
    const primary = { interpret: async () => { throw new Error('provider down'); } };
    const interpreter = createResilientIntentInterpreter({ primary });
    const result = await interpreter.interpret('Alquiler en Rosario hasta ARS 700.000');
    assert.equal(result.provider, 'deterministic');
    assert.equal(result.fallbackReason, 'provider_unavailable');
    assert.equal(result.criteria.maxPrice, 700000);
  });
});
