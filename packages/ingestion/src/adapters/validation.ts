import {
  sourceDiscoveryPageSchema,
  sourceSnapshotSchema,
  type SourceDiscoveryPage,
  type SourceSnapshot
} from '@realty/core';

export class SourceAdapterValidationError extends Error {
  override readonly name = 'SourceAdapterValidationError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export function validateSnapshotForSource(sourceCode: string, input: unknown): SourceSnapshot {
  const parsed = sourceSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    throw new SourceAdapterValidationError(`Invalid snapshot for source "${sourceCode}"`, {
      cause: parsed.error
    });
  }
  if (parsed.data.sourceCode !== sourceCode) {
    throw new SourceAdapterValidationError(
      `Snapshot sourceCode "${parsed.data.sourceCode}" does not match adapter "${sourceCode}"`
    );
  }
  return parsed.data;
}

export function validateDiscoveryPageForSource(
  sourceCode: string,
  input: unknown,
  maximumSnapshots = Number.POSITIVE_INFINITY
): SourceDiscoveryPage {
  const parsed = sourceDiscoveryPageSchema.safeParse(input);
  if (!parsed.success) {
    throw new SourceAdapterValidationError(`Invalid discovery page for source "${sourceCode}"`, {
      cause: parsed.error
    });
  }
  if (parsed.data.snapshots.length > maximumSnapshots) {
    throw new SourceAdapterValidationError(
      `Source "${sourceCode}" returned ${parsed.data.snapshots.length} snapshots; limit is ${maximumSnapshots}`
    );
  }
  for (const snapshot of parsed.data.snapshots) {
    if (snapshot.sourceCode !== sourceCode) {
      throw new SourceAdapterValidationError(
        `Snapshot sourceCode "${snapshot.sourceCode}" does not match adapter "${sourceCode}"`
      );
    }
  }
  return parsed.data;
}

export function parseOffsetCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^\d+$/.test(cursor)) throw new SourceAdapterValidationError('Cursor must be a non-negative integer');
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset)) throw new SourceAdapterValidationError('Cursor is outside the safe range');
  return offset;
}
