import { z } from 'zod';

const nonEmptyTextSchema = z.string().trim().min(1);
const timestampSchema = z.string().datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const currencySchema = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/));

export const operationSchema = z.enum(['sale', 'rent', 'wanted']);
export type Operation = z.infer<typeof operationSchema>;

export const sourcePublicationStatusSchema = z.enum(['active', 'paused', 'removed', 'unknown']);
export type SourcePublicationStatus = z.infer<typeof sourcePublicationStatusSchema>;

export const canonicalConfidenceStateSchema = z.enum(['confirmed', 'likely', 'potential']);
export type CanonicalConfidenceState = z.infer<typeof canonicalConfidenceStateSchema>;

export const publisherTypeSchema = z.enum(['owner', 'operator', 'aggregated']);
export type PublisherType = z.infer<typeof publisherTypeSchema>;

export const freshnessSchema = z.enum([
  'verified_today',
  'verified_recently',
  'status_uncertain',
  'possibly_unavailable',
  'removed_from_source'
]);
export type Freshness = z.infer<typeof freshnessSchema>;

export const normalizedPublicationSchema = z.object({
  title: nonEmptyTextSchema.optional(),
  description: z.string().trim().optional(),
  address: nonEmptyTextSchema.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  propertyType: nonEmptyTextSchema.optional(),
  operation: operationSchema.exclude(['wanted']).optional(),
  currency: currencySchema.optional(),
  price: z.number().nonnegative().optional(),
  rooms: z.number().int().nonnegative().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
  areaTotalM2: z.number().positive().optional(),
  areaCoveredM2: z.number().positive().optional(),
  floor: nonEmptyTextSchema.optional()
}).strict();
export type NormalizedPublication = z.infer<typeof normalizedPublicationSchema>;

export const sourceStatusEvidenceSchema = z.object({
  kind: z.enum(['api_field', 'feed_presence', 'http_status', 'manual']),
  observedAt: timestampSchema,
  detail: nonEmptyTextSchema.optional(),
  httpStatus: z.number().int().min(100).max(599).optional()
}).strict();
export type SourceStatusEvidence = z.infer<typeof sourceStatusEvidenceSchema>;

export const sourceSnapshotSchema = z.object({
  sourceCode: nonEmptyTextSchema,
  sourceListingId: nonEmptyTextSchema,
  directUrl: z.string().url(),
  fetchedAt: timestampSchema,
  status: sourcePublicationStatusSchema,
  statusEvidence: sourceStatusEvidenceSchema,
  raw: z.record(z.string(), z.unknown()),
  normalized: normalizedPublicationSchema
}).strict();
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;

export const sourceDiscoveryPageSchema = z.object({
  snapshots: z.array(sourceSnapshotSchema),
  nextCursor: nonEmptyTextSchema.optional()
}).strict();
export type SourceDiscoveryPage = z.infer<typeof sourceDiscoveryPageSchema>;

export const searchCriteriaSchema = z.object({
  operation: operationSchema.exclude(['wanted']).optional(),
  locations: z.array(nonEmptyTextSchema).min(1).optional(),
  currency: currencySchema.optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  minAreaM2: z.number().nonnegative().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  rooms: z.number().int().nonnegative().optional(),
  excludedFloors: z.array(nonEmptyTextSchema).min(1).optional(),
  preferences: z.array(nonEmptyTextSchema).optional()
}).strict().superRefine((criteria, context) => {
  if (
    criteria.minPrice !== undefined &&
    criteria.maxPrice !== undefined &&
    criteria.minPrice > criteria.maxPrice
  ) {
    context.addIssue({
      code: 'custom',
      path: ['maxPrice'],
      message: 'maxPrice must be greater than or equal to minPrice'
    });
  }
});
export type SearchCriteria = z.infer<typeof searchCriteriaSchema>;

export const intentConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof intentConfidenceSchema>;

export const intentInterpretationSchema = z.object({
  criteria: searchCriteriaSchema,
  confidence: intentConfidenceSchema,
  assumptions: z.array(nonEmptyTextSchema).max(10),
  evidence: z.array(z.object({
    input: nonEmptyTextSchema,
    interpretedAs: nonEmptyTextSchema
  }).strict()).max(20),
  provider: z.enum(['deterministic', 'openai']),
  model: nonEmptyTextSchema.optional(),
  requestId: nonEmptyTextSchema.optional(),
  fallbackReason: z.enum(['provider_unavailable', 'provider_invalid_response']).optional(),
  requiresConfirmation: z.literal(true)
}).strict();
export type IntentInterpretation = z.infer<typeof intentInterpretationSchema>;

export const opportunityDtoSchema = z.object({
  id: z.string().uuid(),
  title: nonEmptyTextSchema,
  address: nonEmptyTextSchema.nullable(),
  operation: operationSchema,
  price: z.number().nonnegative().nullable(),
  currency: currencySchema.nullable(),
  areaTotalM2: z.number().nonnegative().nullable(),
  bedrooms: z.number().int().nonnegative().nullable().optional(),
  rooms: z.number().int().nonnegative().nullable(),
  floor: nonEmptyTextSchema.nullable().optional(),
  publicationCount: z.number().int().nonnegative(),
  lastVerifiedAt: nullableTimestampSchema,
  freshness: freshnessSchema.optional(),
  preferenceMatches: z.array(nonEmptyTextSchema).optional()
}).strict();
export type OpportunityDto = z.infer<typeof opportunityDtoSchema>;

// Kept as the domain-facing alias used by the current worker.
export type Opportunity = OpportunityDto;

export const publicationDtoSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  sourceCode: nonEmptyTextSchema,
  sourceName: nonEmptyTextSchema,
  sourceListingId: nonEmptyTextSchema,
  sourceUrl: z.string().url(),
  publisherType: publisherTypeSchema.nullable(),
  publisherName: nonEmptyTextSchema.nullable(),
  title: nonEmptyTextSchema.nullable(),
  description: z.string().nullable(),
  currency: currencySchema.nullable(),
  price: z.number().nonnegative().nullable(),
  status: sourcePublicationStatusSchema,
  firstSeenAt: timestampSchema,
  lastSeenAt: timestampSchema,
  lastVerifiedAt: nullableTimestampSchema
}).strict();
export type PublicationDto = z.infer<typeof publicationDtoSchema>;

export const monitorDtoSchema = z.object({
  id: z.string().uuid(),
  name: nonEmptyTextSchema,
  intentText: nonEmptyTextSchema,
  criteria: searchCriteriaSchema,
  cadence: z.enum(['hourly', 'daily', 'weekly']),
  timezone: nonEmptyTextSchema,
  instantExceptional: z.boolean(),
  enabled: z.boolean(),
  lastRunAt: nullableTimestampSchema,
  nextRunAt: nullableTimestampSchema,
  createdAt: timestampSchema
}).strict();
export type MonitorDto = z.infer<typeof monitorDtoSchema>;

export const alertDtoSchema = z.object({
  id: z.string().uuid(),
  monitorId: z.string().uuid().nullable(),
  type: nonEmptyTextSchema,
  title: nonEmptyTextSchema,
  body: nonEmptyTextSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
  readAt: nullableTimestampSchema
}).strict();
export type AlertDto = z.infer<typeof alertDtoSchema>;

export const propertyHistoryEventDtoSchema = z.object({
  type: nonEmptyTextSchema,
  occurredAt: timestampSchema,
  payload: z.record(z.string(), z.unknown())
}).strict();
export type PropertyHistoryEventDto = z.infer<typeof propertyHistoryEventDtoSchema>;

export const operatorProfileDtoSchema = z.object({
  id: z.string().uuid(),
  displayName: nonEmptyTextSchema,
  legalName: nonEmptyTextSchema.nullable(),
  licenseNumber: nonEmptyTextSchema.nullable(),
  websiteUrl: z.string().url().nullable(),
  verificationStatus: z.enum(['pending', 'verified', 'rejected', 'suspended']),
  verifiedAt: nullableTimestampSchema,
  createdAt: timestampSchema
}).strict();
export type OperatorProfileDto = z.infer<typeof operatorProfileDtoSchema>;

export const managedPublicationDtoSchema = publicationDtoSchema.extend({
  address: nonEmptyTextSchema.nullable(),
  propertyStatus: z.enum(['active', 'uncertain', 'inactive', 'sold', 'rented']),
  declaredAvailability: z.enum(['available', 'reserved', 'sold', 'rented', 'unavailable', 'unknown']),
  version: z.number().int().positive()
}).strict();
export type ManagedPublicationDto = z.infer<typeof managedPublicationDtoSchema>;

export const listingClaimDtoSchema = z.object({
  id: z.string().uuid(),
  publicationId: z.string().uuid(),
  propertyId: z.string().uuid(),
  address: nonEmptyTextSchema.nullable(),
  sourceName: nonEmptyTextSchema,
  status: z.enum(['pending', 'approved', 'rejected', 'revoked']),
  evidence: z.record(z.string(), z.unknown()),
  reviewedAt: nullableTimestampSchema,
  createdAt: timestampSchema
}).strict();
export type ListingClaimDto = z.infer<typeof listingClaimDtoSchema>;

export const inquiryDtoSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  publicationId: z.string().uuid(),
  senderUserId: z.string().uuid(),
  recipientUserId: z.string().uuid(),
  message: nonEmptyTextSchema,
  status: z.enum(['new', 'read', 'replied', 'closed']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict();
export type InquiryDto = z.infer<typeof inquiryDtoSchema>;
