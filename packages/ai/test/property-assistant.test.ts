import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeterministicPropertyAssistant, OpenAIPropertyAssistant } from '../src/index.js';

const context = {
  id: '00000000-0000-4000-8000-000000000001',
  address: 'Aráoz 1840, Palermo', price: 225000, currency: 'USD', areaTotalM2: 75,
  rooms: 3, bedrooms: 2, floor: '4', freshness: 'verified_today',
  publications: [{ sourceName: 'Publicación directa', publisherType: 'owner', publisherName: 'Leo', price: 225000, currency: 'USD', status: 'active', lastVerifiedAt: '2026-09-09T12:00:00.000Z' }]
};

describe('property assistant', () => {
  it('calculates price per square metre from canonical facts', async () => {
    const result = await new DeterministicPropertyAssistant().answer('¿Cuál es el precio por m²?', context);
    assert.match(result.answer, /USD 3\.000/);
    assert.equal(result.evidence.length, 2);
    assert.equal(result.provider, 'deterministic');
  });

  it('does not invent missing subjective evidence', async () => {
    const result = await new DeterministicPropertyAssistant().answer('¿Es luminoso y silencioso?', context);
    assert.match(result.caveats.join(' '), /No tenemos evidencia suficiente/);
  });

  it('validates strict provider output', async () => {
    const fetchStub: typeof fetch = async () => new Response(JSON.stringify({
      status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        answer: 'La fuente fue verificada hoy.', evidence: [{ label: 'Frescura', value: 'Hoy', source: 'canonical_property' }], caveats: []
      }) }] }]
    }), { status: 200, headers: { 'x-request-id': 'req_property_test' } });
    const result = await new OpenAIPropertyAssistant({ apiKey: 'test', model: 'gpt-test', fetch: fetchStub }).answer('¿Está vigente?', context);
    assert.equal(result.provider, 'openai');
    assert.equal(result.requestId, 'req_property_test');
  });
});
