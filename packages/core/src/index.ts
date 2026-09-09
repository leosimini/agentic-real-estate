export type SearchCriteria = {
  operation?: 'sale' | 'rent';
  locations?: string[];
  currency?: string;
  minPrice?: number;
  maxPrice?: number;
  minAreaM2?: number;
  bedrooms?: number;
  rooms?: number;
  excludedFloors?: string[];
  preferences?: string[];
};

export type Opportunity = {
  id: string;
  title: string;
  address: string | null;
  operation: 'sale' | 'rent' | 'wanted';
  price: number | null;
  currency: string | null;
  areaTotalM2: number | null;
  rooms: number | null;
  publicationCount: number;
  lastVerifiedAt: string | null;
};

export function basicMatchScore(criteria: SearchCriteria, item: Opportunity): number {
  let score = 70;
  if (criteria.maxPrice && item.price && item.price <= criteria.maxPrice) score += 10;
  if (criteria.minAreaM2 && item.areaTotalM2 && item.areaTotalM2 >= criteria.minAreaM2) score += 10;
  if (criteria.rooms && item.rooms && item.rooms >= criteria.rooms) score += 10;
  return Math.min(100, score);
}

export * from './source-adapter.js';
