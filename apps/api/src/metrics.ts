const durationBuckets = [0.1, 0.25, 0.5, 1, 2.5, 5] as const;

type Counter = { count: number; sumSeconds: number; buckets: number[] };

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

export class HttpMetrics {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, Counter>();

  record(method: string, route: string, statusCode: number, durationMs: number) {
    const labels = `${method}\u0000${route}\u0000${statusCode}`;
    const counter = this.requests.get(labels) ?? {
      count: 0, sumSeconds: 0, buckets: durationBuckets.map(() => 0)
    };
    const seconds = Math.max(0, durationMs) / 1000;
    counter.count += 1;
    counter.sumSeconds += seconds;
    durationBuckets.forEach((bucket, index) => {
      if (seconds <= bucket) counter.buckets[index]! += 1;
    });
    this.requests.set(labels, counter);
  }

  render(): string {
    const lines = [
      '# HELP process_uptime_seconds Process uptime in seconds.',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${Math.max(0, Date.now() - this.startedAt) / 1000}`,
      '# HELP http_server_requests_total Completed HTTP requests.',
      '# TYPE http_server_requests_total counter',
      '# HELP http_server_request_duration_seconds HTTP request duration.',
      '# TYPE http_server_request_duration_seconds histogram'
    ];
    for (const [key, counter] of [...this.requests.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [method = 'UNKNOWN', route = 'unmatched', status = '0'] = key.split('\u0000');
      const base = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"`;
      lines.push(`http_server_requests_total{${base}} ${counter.count}`);
      durationBuckets.forEach((bucket, index) => {
        lines.push(`http_server_request_duration_seconds_bucket{${base},le="${bucket}"} ${counter.buckets[index]}`);
      });
      lines.push(`http_server_request_duration_seconds_bucket{${base},le="+Inf"} ${counter.count}`);
      lines.push(`http_server_request_duration_seconds_sum{${base}} ${counter.sumSeconds}`);
      lines.push(`http_server_request_duration_seconds_count{${base}} ${counter.count}`);
    }
    return `${lines.join('\n')}\n`;
  }
}
