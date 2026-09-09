import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HttpSourceAdapter,
  ManualImportSourceAdapter,
  SimulatedSourceAdapter,
  SourceAdapterValidationError
} from '../src/index.js';
import { snapshot } from './fixtures.js';

describe('source adapters', () => {
  it('validates manual imports atomically at the core schema boundary', async () => {
    const adapter = new ManualImportSourceAdapter({ code: 'manual' });
    assert.throws(
      () => adapter.import([
        snapshot({ sourceCode: 'manual' }),
        { sourceCode: 'manual', sourceListingId: 'invalid' }
      ]),
      SourceAdapterValidationError
    );
    assert.deepEqual((await adapter.discover()).snapshots, []);
  });

  it('preserves removed status and evidence through simulation and verification', async () => {
    const removed = snapshot({
      status: 'removed',
      statusEvidence: {
        kind: 'http_status',
        observedAt: '2026-09-09T13:00:00Z',
        httpStatus: 404
      }
    });
    const adapter = new SimulatedSourceAdapter({ code: 'demo', snapshots: [removed] });

    assert.equal((await adapter.discover()).snapshots[0]?.status, 'removed');
    assert.equal((await adapter.verify(removed.sourceListingId, removed.directUrl)).status, 'removed');
  });

  it('guards HTTP endpoints and validates mapped responses', async () => {
    assert.throws(
      () => new HttpSourceAdapter({
        code: 'feed',
        discoverUrl: 'http://feed.example/listings',
        allowedHosts: ['feed.example'],
        buildVerifyUrl: () => 'https://feed.example/listing/1'
      }),
      /require HTTPS/
    );

    const adapter = new HttpSourceAdapter({
      code: 'feed',
      discoverUrl: 'https://feed.example/listings',
      allowedHosts: ['feed.example'],
      buildVerifyUrl: () => 'https://feed.example/listing/1',
      fetchImplementation: async () => new Response(JSON.stringify({ snapshots: [{ invalid: true }] }), {
        headers: { 'content-type': 'application/json' }
      })
    });

    await assert.rejects(() => adapter.discover(), SourceAdapterValidationError);
  });

  it('maps a source-specific HTTP envelope before core validation', async () => {
    const feedSnapshot = snapshot({ sourceCode: 'feed' });
    const adapter = new HttpSourceAdapter({
      code: 'feed',
      discoverUrl: 'https://feed.example/listings',
      allowedHosts: ['feed.example'],
      buildVerifyUrl: () => 'https://feed.example/listing/1',
      mapDiscoveryResponse: (payload) => ({ snapshots: (payload as { data: unknown }).data }),
      fetchImplementation: async () => new Response(JSON.stringify({ data: [feedSnapshot] }), {
        headers: { 'content-type': 'application/json' }
      })
    });

    const page = await adapter.discover('opaque-cursor');
    assert.equal(page.snapshots[0]?.sourceCode, 'feed');
  });

  it('does not allow a verification URL builder to escape the host allowlist', async () => {
    const adapter = new HttpSourceAdapter({
      code: 'feed',
      discoverUrl: 'https://feed.example/listings',
      allowedHosts: ['feed.example'],
      buildVerifyUrl: () => 'https://attacker.example/internal',
      fetchImplementation: async () => {
        throw new Error('fetch should not be reached');
      }
    });

    await assert.rejects(
      () => adapter.verify('listing-1', 'https://source.example/listings/1'),
      /not allowed/
    );
  });
});
