import type {
  ChangeSignificance,
  MeaningfulChangePolicy,
  MonitorChangeEvent
} from './types.js';

export const DEFAULT_MEANINGFUL_CHANGE_POLICY: MeaningfulChangePolicy = Object.freeze({
  minimumScore: 80,
  minimumPriceDropPercent: 3,
  notifyOnAvailabilityChange: true,
  notifyOnSourceChange: true,
  notifyOnRemovedMatch: true
});

export function resolveMeaningfulChangePolicy(
  policy: Partial<MeaningfulChangePolicy> = {}
): MeaningfulChangePolicy {
  const resolved = { ...DEFAULT_MEANINGFUL_CHANGE_POLICY, ...policy };
  if (!Number.isFinite(resolved.minimumScore)) throw new Error('minimumScore must be finite');
  if (!Number.isFinite(resolved.minimumPriceDropPercent) || resolved.minimumPriceDropPercent < 0) {
    throw new Error('minimumPriceDropPercent must be a non-negative finite number');
  }
  return resolved;
}

function relevant(score: number, policy: MeaningfulChangePolicy): boolean {
  return score >= policy.minimumScore;
}

export function evaluateMeaningfulChange(
  event: MonitorChangeEvent,
  inputPolicy: Partial<MeaningfulChangePolicy> = {}
): ChangeSignificance {
  const policy = resolveMeaningfulChangePolicy(inputPolicy);

  switch (event.type) {
    case 'new_match':
      return relevant(event.current.score, policy)
        ? { meaningful: true, reason: 'new_match_above_score_threshold' }
        : { meaningful: false, reason: 'below_score_threshold' };

    case 'removed_match':
      return policy.notifyOnRemovedMatch && relevant(event.previous.score, policy)
        ? { meaningful: true, reason: 'relevant_match_removed' }
        : { meaningful: false, reason: 'removed_match_suppressed' };

    case 'availability_changed':
      return policy.notifyOnAvailabilityChange && relevant(event.score, policy)
        ? { meaningful: true, reason: 'availability_changed' }
        : { meaningful: false, reason: 'availability_change_suppressed' };

    case 'sources_changed':
      return policy.notifyOnSourceChange && relevant(event.score, policy)
        ? { meaningful: true, reason: 'active_sources_changed' }
        : { meaningful: false, reason: 'source_change_suppressed' };

    case 'score_changed': {
      const crossedUp = event.previous < policy.minimumScore && event.current >= policy.minimumScore;
      const crossedDown = event.previous >= policy.minimumScore && event.current < policy.minimumScore;
      return crossedUp || crossedDown
        ? { meaningful: true, reason: crossedUp ? 'score_crossed_threshold_up' : 'score_crossed_threshold_down' }
        : { meaningful: false, reason: 'score_did_not_cross_threshold' };
    }

    case 'price_changed': {
      if (!event.previous || !event.current) return { meaningful: false, reason: 'price_not_comparable' };
      if (event.previous.currency.toUpperCase() !== event.current.currency.toUpperCase()) {
        return { meaningful: false, reason: 'price_currency_changed' };
      }
      if (event.previous.amount <= 0 || event.current.amount >= event.previous.amount) {
        return { meaningful: false, reason: 'price_did_not_drop' };
      }
      if (!relevant(event.score, policy)) return { meaningful: false, reason: 'below_score_threshold' };

      const dropPercent = ((event.previous.amount - event.current.amount) / event.previous.amount) * 100;
      return dropPercent >= policy.minimumPriceDropPercent
        ? { meaningful: true, reason: 'price_drop_exceeded_threshold' }
        : { meaningful: false, reason: 'price_drop_below_threshold' };
    }
  }
}
