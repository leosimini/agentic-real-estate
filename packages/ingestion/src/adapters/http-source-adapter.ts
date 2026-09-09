import type { SourceAdapter, SourceDiscoveryPage, SourceSnapshot } from '@realty/core';
import {
  SourceAdapterValidationError,
  validateDiscoveryPageForSource,
  validateSnapshotForSource
} from './validation.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAXIMUM_BYTES = 2_000_000;
const DEFAULT_MAXIMUM_SNAPSHOTS = 500;

export type HttpSourceAdapterOptions = {
  code: string;
  discoverUrl: string;
  allowedHosts: readonly string[];
  buildVerifyUrl: (sourceListingId: string, directUrl: string) => string | URL;
  mapDiscoveryResponse?: (payload: unknown) => unknown;
  mapVerificationResponse?: (payload: unknown) => unknown;
  headers?: Readonly<Record<string, string>>;
  cursorParameter?: string;
  timeoutMs?: number;
  maximumResponseBytes?: number;
  maximumSnapshots?: number;
  fetchImplementation?: typeof fetch;
};

export class HttpSourceAdapter implements SourceAdapter {
  readonly code: string;
  readonly #discoverUrl: URL;
  readonly #allowedHosts: ReadonlySet<string>;
  readonly #buildVerifyUrl: HttpSourceAdapterOptions['buildVerifyUrl'];
  readonly #mapDiscoveryResponse: NonNullable<HttpSourceAdapterOptions['mapDiscoveryResponse']>;
  readonly #mapVerificationResponse: NonNullable<HttpSourceAdapterOptions['mapVerificationResponse']>;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #cursorParameter: string;
  readonly #timeoutMs: number;
  readonly #maximumResponseBytes: number;
  readonly #maximumSnapshots: number;
  readonly #fetch: typeof fetch;

  constructor(options: HttpSourceAdapterOptions) {
    this.code = options.code.trim();
    if (!this.code) throw new SourceAdapterValidationError('Adapter source code is required');
    this.#allowedHosts = new Set(options.allowedHosts.map((host) => host.trim().toLowerCase()));
    if (this.#allowedHosts.size === 0 || this.#allowedHosts.has('')) {
      throw new SourceAdapterValidationError('At least one non-empty allowed host is required');
    }
    this.#discoverUrl = this.#guardUrl(options.discoverUrl);
    this.#buildVerifyUrl = options.buildVerifyUrl;
    this.#mapDiscoveryResponse = options.mapDiscoveryResponse ?? ((payload) => payload);
    this.#mapVerificationResponse = options.mapVerificationResponse ?? ((payload) => payload);
    this.#headers = Object.freeze({ accept: 'application/json', ...options.headers });
    this.#cursorParameter = options.cursorParameter ?? 'cursor';
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
    this.#maximumResponseBytes = positiveInteger(
      options.maximumResponseBytes ?? DEFAULT_MAXIMUM_BYTES,
      'maximumResponseBytes'
    );
    this.#maximumSnapshots = positiveInteger(
      options.maximumSnapshots ?? DEFAULT_MAXIMUM_SNAPSHOTS,
      'maximumSnapshots'
    );
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async discover(cursor?: string): Promise<SourceDiscoveryPage> {
    const url = new URL(this.#discoverUrl);
    if (cursor !== undefined) url.searchParams.set(this.#cursorParameter, cursor);
    const payload = await this.#requestJson(this.#guardUrl(url));
    return validateDiscoveryPageForSource(
      this.code,
      this.#mapDiscoveryResponse(payload),
      this.#maximumSnapshots
    );
  }

  async verify(sourceListingId: string, directUrl: string): Promise<SourceSnapshot> {
    if (!sourceListingId.trim()) throw new SourceAdapterValidationError('sourceListingId is required');
    // The callback may not bypass endpoint policy: its result is guarded again.
    const url = this.#guardUrl(this.#buildVerifyUrl(sourceListingId, directUrl));
    const payload = await this.#requestJson(url);
    const snapshot = validateSnapshotForSource(this.code, this.#mapVerificationResponse(payload));
    if (snapshot.sourceListingId !== sourceListingId) {
      throw new SourceAdapterValidationError(
        `Verification returned listing "${snapshot.sourceListingId}" instead of "${sourceListingId}"`
      );
    }
    return snapshot;
  }

  #guardUrl(input: string | URL): URL {
    let url: URL;
    try {
      url = new URL(input);
    } catch (error) {
      throw new SourceAdapterValidationError('HTTP adapter URL is invalid', { cause: error });
    }
    const host = url.hostname.toLowerCase();
    const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
    if (url.protocol !== 'https:') throw new SourceAdapterValidationError('HTTP adapters require HTTPS');
    if (url.username || url.password) throw new SourceAdapterValidationError('Credentials are not allowed in URLs');
    if (url.port && url.port !== '443') throw new SourceAdapterValidationError('Only the standard HTTPS port is allowed');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIpLiteral) {
      throw new SourceAdapterValidationError('Local and IP-literal HTTP adapter hosts are blocked');
    }
    if (!this.#allowedHosts.has(host)) {
      throw new SourceAdapterValidationError(`Host "${host}" is not allowed for this adapter`);
    }
    return url;
  }

  async #requestJson(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method: 'GET',
        headers: this.#headers,
        redirect: 'error',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new SourceAdapterValidationError(
          `Source "${this.code}" responded with HTTP ${response.status}`
        );
      }
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes('json')) {
        throw new SourceAdapterValidationError('HTTP adapter response must use a JSON content type');
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > this.#maximumResponseBytes) {
        throw new SourceAdapterValidationError('HTTP adapter response exceeds the configured size limit');
      }
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > this.#maximumResponseBytes) {
        throw new SourceAdapterValidationError('HTTP adapter response exceeds the configured size limit');
      }
      try {
        return JSON.parse(body) as unknown;
      } catch (error) {
        throw new SourceAdapterValidationError('HTTP adapter response contains invalid JSON', { cause: error });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SourceAdapterValidationError(`${name} must be a positive integer`);
  }
  return value;
}

export { SourceAdapterValidationError } from './validation.js';
