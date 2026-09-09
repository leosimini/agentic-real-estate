import type { SourceAdapter, SourceDiscoveryPage, SourceSnapshot } from '@realty/core';
import { SnapshotCatalog } from './snapshot-catalog.js';

export type SimulatedSourceAdapterOptions = {
  code: string;
  snapshots: readonly unknown[];
  pageSize?: number;
};

export class SimulatedSourceAdapter implements SourceAdapter {
  readonly code: string;
  readonly #catalog: SnapshotCatalog;

  constructor(options: SimulatedSourceAdapterOptions) {
    this.code = options.code.trim();
    this.#catalog = new SnapshotCatalog(this.code, options.pageSize ?? 100);
    this.#catalog.import(options.snapshots);
  }

  async discover(cursor?: string): Promise<SourceDiscoveryPage> {
    return this.#catalog.discover(cursor);
  }

  async verify(sourceListingId: string, directUrl: string): Promise<SourceSnapshot> {
    return this.#catalog.verify(sourceListingId, directUrl);
  }
}
