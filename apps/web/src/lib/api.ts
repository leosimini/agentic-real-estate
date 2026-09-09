export type Operation = 'sale' | 'rent';
export type Currency = 'USD' | 'ARS';

export type SearchCriteria = {
  operation?: Operation;
  locations?: string[];
  currency?: Currency;
  minPrice?: number;
  maxPrice?: number;
  minAreaM2?: number;
  bedrooms?: number;
  rooms?: number;
  excludedFloors?: string[];
  preferences?: string[];
};

export type IntentInterpretation = {
  criteria: SearchCriteria;
  confidence: 'high' | 'medium' | 'low';
  assumptions: string[];
  evidence: Array<{ input: string; interpretedAs: string }>;
  provider: 'deterministic' | 'openai';
  model?: string;
  requestId?: string;
  fallbackReason?: 'provider_unavailable' | 'provider_invalid_response';
  promptVersion: string;
  requiresConfirmation: true;
};

export type PropertyAnswer = {
  answer: string;
  evidence: Array<{ label: string; value: string; source: 'canonical_property' | 'source_publication' }>;
  caveats: string[];
  provider: 'deterministic' | 'openai';
  model?: string;
  requestId?: string;
  fallbackReason?: 'provider_unavailable' | 'provider_invalid_response';
  promptVersion: string;
};

export type Opportunity = {
  id: string;
  title: string;
  address: string | null;
  operation: Operation | 'wanted';
  price: number | null;
  currency: string | null;
  areaTotalM2: number | null;
  bedrooms?: number | null;
  rooms: number | null;
  floor?: string | null;
  publicationCount: number;
  lastVerifiedAt: string | null;
  freshness?: 'verified_today' | 'verified_recently' | 'status_uncertain' | 'possibly_unavailable' | 'removed_from_source';
};

export type Publication = {
  id: string;
  title?: string | null;
  description?: string | null;
  sourceName: string;
  sourceUrl: string;
  publisherType: 'owner' | 'operator' | 'aggregated' | null;
  publisherName: string | null;
  price: number | null;
  currency: string | null;
  status: 'active' | 'paused' | 'removed' | 'unknown';
  lastVerifiedAt: string | null;
};

export type OpportunityDetail = {
  opportunity: Opportunity;
  publications: Publication[];
  history: Array<{ type: string; occurredAt: string; payload: Record<string, unknown> }>;
};

export type Monitor = {
  id: string;
  name: string;
  intentText: string;
  criteria: SearchCriteria;
  cadence: 'hourly' | 'daily' | 'weekly';
  timezone: string;
  instantExceptional: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
};

export type Alert = {
  id: string;
  monitorId: string | null;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
};

export type OperatorProfile = {
  id: string;
  displayName: string;
  legalName: string | null;
  licenseNumber: string | null;
  websiteUrl: string | null;
  verificationStatus: 'pending' | 'verified' | 'rejected' | 'suspended';
  verifiedAt: string | null;
  createdAt: string;
};

export type ManagedPublication = Publication & {
  propertyId: string;
  address: string | null;
  propertyStatus: 'active' | 'uncertain' | 'inactive' | 'sold' | 'rented';
  declaredAvailability: 'available' | 'reserved' | 'sold' | 'rented' | 'unavailable' | 'unknown';
  version: number;
};

export type Inquiry = {
  id: string;
  propertyId: string;
  publicationId: string;
  senderUserId: string;
  recipientUserId: string;
  message: string;
  status: 'new' | 'read' | 'replied' | 'closed';
  createdAt: string;
  updatedAt: string;
};

type ApiErrorBody = { error?: { code?: string; message?: string } };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { ...options, headers, cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as ApiErrorBody;
    throw new ApiError(
      response.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? 'No pudimos completar la solicitud.'
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function searchQuery(criteria: SearchCriteria): string {
  const params = new URLSearchParams();
  if (criteria.operation) params.set('operation', criteria.operation);
  if (criteria.currency) params.set('currency', criteria.currency);
  if (criteria.locations?.length) params.set('locations', criteria.locations.join(','));
  if (criteria.minPrice !== undefined) params.set('minPrice', String(criteria.minPrice));
  if (criteria.maxPrice !== undefined) params.set('maxPrice', String(criteria.maxPrice));
  if (criteria.minAreaM2 !== undefined) params.set('minAreaM2', String(criteria.minAreaM2));
  if (criteria.rooms !== undefined) params.set('rooms', String(criteria.rooms));
  return params.toString();
}
