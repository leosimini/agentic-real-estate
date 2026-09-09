import type { SourceAdapter, SourceDiscoveryPage, SourceSnapshot } from '@realty/core';
import { SnapshotCatalog } from './snapshot-catalog.js';

export type ManualImportSourceAdapterOptions = {
  code: string;
  pageSize?: number;
};

export class ManualImportSourceAdapter implements SourceAdapter {
  readonly code: string;
  readonly #catalog: SnapshotCatalog;

  constructor(options: ManualImportSourceAdapterOptions) {
    this.code = options.code.trim();
    this.#catalog = new SnapshotCatalog(this.code, options.pageSize ?? 100);
  }

  import(inputs: readonly unknown[]): SourceSnapshot[] {
    return this.#catalog.import(inputs);
  }

  async discover(cursor?: string): Promise<SourceDiscoveryPage> {
    return this.#catalog.discover(cursor);
  }

  async verify(sourceListingId: string, directUrl: string): Promise<SourceSnapshot> {
    return this.#catalog.verify(sourceListingId, directUrl);
  }
}
