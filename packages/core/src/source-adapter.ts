import type { SourceDiscoveryPage, SourceSnapshot } from './contracts.js';

export interface SourceAdapter {
  readonly code: string;
  discover(cursor?: string): Promise<SourceDiscoveryPage>;
  verify(sourceListingId: string, directUrl: string): Promise<SourceSnapshot>;
}
