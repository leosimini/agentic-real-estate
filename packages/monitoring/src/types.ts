export const AVAILABILITY_STATES = [
  'active',
  'uncertain',
  'inactive',
  'removed',
  'sold',
  'rented'
] as const;

export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

export type Money = Readonly<{
  amount: number;
  currency: string;
}>;

export type MonitorCandidateSnapshot = Readonly<{
  propertyId: string;
  score: number;
  price: Money | null;
  availability: AvailabilityState;
  activeSourceIds: readonly string[];
}>;

export type MonitorSnapshot = Readonly<{
  monitorId: string;
  observationKey: string;
  observedAt: string;
  candidates: readonly MonitorCandidateSnapshot[];
}>;

type EventBase = Readonly<{
  monitorId: string;
  propertyId: string;
  detectedAt: string;
}>;

export type NewMatchEvent = EventBase & Readonly<{
  type: 'new_match';
  current: MonitorCandidateSnapshot;
}>;

export type RemovedMatchEvent = EventBase & Readonly<{
  type: 'removed_match';
  previous: MonitorCandidateSnapshot;
}>;

export type PriceChangedEvent = EventBase & Readonly<{
  type: 'price_changed';
  previous: Money | null;
  current: Money | null;
  score: number;
}>;

export type AvailabilityChangedEvent = EventBase & Readonly<{
  type: 'availability_changed';
  previous: AvailabilityState;
  current: AvailabilityState;
  score: number;
}>;

export type SourcesChangedEvent = EventBase & Readonly<{
  type: 'sources_changed';
  addedSourceIds: readonly string[];
  removedSourceIds: readonly string[];
  score: number;
}>;

export type ScoreChangedEvent = EventBase & Readonly<{
  type: 'score_changed';
  previous: number;
  current: number;
}>;

export type MonitorChangeEvent =
  | NewMatchEvent
  | RemovedMatchEvent
  | PriceChangedEvent
  | AvailabilityChangedEvent
  | SourcesChangedEvent
  | ScoreChangedEvent;

export type MeaningfulChangePolicy = Readonly<{
  minimumScore: number;
  minimumPriceDropPercent: number;
  notifyOnAvailabilityChange: boolean;
  notifyOnSourceChange: boolean;
  notifyOnRemovedMatch: boolean;
}>;

export type ChangeSignificance = Readonly<{
  meaningful: boolean;
  reason: string;
}>;

export const DIGEST_GROUPS = [
  'new_matches',
  'price_drops',
  'availability_changes',
  'source_changes',
  'score_changes',
  'removed_matches'
] as const;

export type DigestGroupKind = (typeof DIGEST_GROUPS)[number];

export type DigestGroup = Readonly<{
  kind: DigestGroupKind;
  events: readonly MonitorChangeEvent[];
}>;

export type SuppressionReason = 'not_meaningful' | 'property_suppressed' | 'already_delivered' | 'group_limit';

export type SuppressedChange = Readonly<{
  event: MonitorChangeEvent;
  reason: SuppressionReason;
}>;

export type MonitorDigest = Readonly<{
  monitorId: string;
  windowKey: string;
  alertKey: string;
  groups: readonly DigestGroup[];
  eventKeys: readonly string[];
  suppressed: readonly SuppressedChange[];
}>;

export type DigestOptions = Readonly<{
  policy?: Partial<MeaningfulChangePolicy>;
  suppressedPropertyIds?: readonly string[];
  previouslyDeliveredEventKeys?: readonly string[];
  maxEventsPerGroup?: number;
}>;

export type NotificationChannel = 'in_app' | 'email' | 'push' | 'whatsapp';
