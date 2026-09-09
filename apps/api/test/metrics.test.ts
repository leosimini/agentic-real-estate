import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpMetrics } from '../src/metrics.js';

describe('HTTP metrics', () => {
  it('renders bounded route labels and cumulative latency buckets', () => {
    const metrics = new HttpMetrics();
    metrics.record('GET', '/v1/opportunities/:id', 200, 80);
    metrics.record('GET', '/v1/opportunities/:id', 200, 300);
    const output = metrics.render();
    assert.match(output, /http_server_requests_total\{method="GET",route="\/v1\/opportunities\/:id",status="200"\} 2/);
    assert.match(output, /le="0.1"\} 1/);
    assert.match(output, /le="0.5"\} 2/);
  });
});
