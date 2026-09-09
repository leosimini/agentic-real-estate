export type SourceSnapshot = {
  sourceCode: string;
  sourceListingId: string;
  directUrl: string;
  fetchedAt: string;
  status: 'active' | 'paused' | 'removed' | 'unknown';
  raw: Record<string, unknown>;
  normalized: {
    title?: string;
    description?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    operation?: 'sale' | 'rent';
    currency?: string;
    price?: number;
    rooms?: number;
    bedrooms?: number;
    bathrooms?: number;
    areaTotalM2?: number;
  };
};

export interface SourceAdapter {
  code: string;
  discover(cursor?: string): Promise<{ snapshots: SourceSnapshot[]; nextCursor?: string }>;
  verify(sourceListingId: string, directUrl: string): Promise<SourceSnapshot>;
}
