const baseUrl = (process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const requestCount = Number(process.env.LOAD_REQUESTS ?? 100);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 10);
const p95LimitMs = Number(process.env.LOAD_P95_LIMIT_MS ?? 400);
const path = process.env.LOAD_PATH ?? '/v1/opportunities?locations=Palermo&currency=USD&limit=20';

if (![requestCount, concurrency, p95LimitMs].every(Number.isFinite) || requestCount < 1 || concurrency < 1 || p95LimitMs < 1) {
  throw new Error('LOAD_REQUESTS, LOAD_CONCURRENCY, and LOAD_P95_LIMIT_MS must be positive numbers');
}

const durations = [];
const errors = [];
let cursor = 0;

async function client() {
  while (cursor < requestCount) {
    cursor += 1;
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}${path}`, { headers: { accept: 'application/json' } });
      await response.arrayBuffer();
      if (!response.ok) errors.push(`HTTP ${response.status}`);
    } catch (error) {
      errors.push(String(error));
    } finally {
      durations.push(performance.now() - started);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, () => client()));
durations.sort((left, right) => left - right);
const percentile = (value) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * value) - 1)];
const report = {
  baseUrl,
  path,
  requests: durations.length,
  concurrency,
  errors: errors.length,
  p50Ms: Number(percentile(0.5).toFixed(1)),
  p95Ms: Number(percentile(0.95).toFixed(1)),
  p99Ms: Number(percentile(0.99).toFixed(1)),
  thresholdMs: p95LimitMs
};
console.log(JSON.stringify(report));
if (errors.length || report.p95Ms > p95LimitMs) process.exitCode = 1;
