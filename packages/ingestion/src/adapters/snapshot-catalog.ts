import type { SourceDiscoveryPage, SourceSnapshot } from '@realty/core';
import {
  SourceAdapterValidationError,
  parseOffsetCursor,
  validateDiscoveryPageForSource,
  validateSnapshotForSource
} from './validation.js';

export class SnapshotCatalog {
  readonly #sourceCode: string;
  readonly #pageSize: number;
  readonly #snapshots: SourceSnapshot[] = [];

  constructor(sourceCode: string, pageSize: number) {
    const normalizedCode = sourceCode.trim();
    if (!normalizedCode) throw new SourceAdapterValidationError('Adapter source code is required');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      throw new SourceAdapterValidationError('pageSize must be an integer from 1 to 500');
    }
    this.#sourceCode = normalizedCode;
    this.#pageSize = pageSize;
  }

  import(inputs: readonly unknown[]): SourceSnapshot[] {
    // Validate the whole batch before mutating the catalog.
    const validated = inputs.map((input) => validateSnapshotForSource(this.#sourceCode, input));
    this.#snapshots.push(...validated);
    return validated;
  }

  discover(cursor?: string): SourceDiscoveryPage {
    const offset = parseOffsetCursor(cursor);
    const snapshots = this.#snapshots.slice(offset, offset + this.#pageSize);
    const nextOffset = offset + snapshots.length;
    return validateDiscoveryPageForSource(this.#sourceCode, {
      snapshots,
      ...(nextOffset < this.#snapshots.length ? { nextCursor: String(nextOffset) } : {})
    });
  }

  verify(sourceListingId: string, directUrl: string): SourceSnapshot {
    const matching = this.#snapshots.filter((snapshot) => snapshot.sourceListingId === sourceListingId);
    const snapshot = matching.at(-1);
    if (!snapshot) {
      throw new SourceAdapterValidationError(
        `Source listing "${sourceListingId}" is not present in adapter "${this.#sourceCode}"`
      );
    }
    if (snapshot.directUrl !== directUrl) {
      throw new SourceAdapterValidationError(
        `Direct URL does not match source listing "${sourceListingId}"`
      );
    }
    return validateSnapshotForSource(this.#sourceCode, snapshot);
  }
}
