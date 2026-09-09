# `@realty/monitoring`

Pure domain logic for comparing monitor observations and deciding which changes
are worth notifying. The package has no database, queue, provider, or clock
dependency, so workers can retry it safely and tests can replay snapshots.

Callers supply a stable `windowKey` when building a digest (for example, a UTC
day for a daily digest or a persisted source-observation ID for an instant
alert). Alert keys are derived from that window and the semantic changes, while
delivery keys are derived from the alert key and channel. Persist both behind
unique constraints before performing external delivery.

Snapshot timestamps and observation keys are deliberately excluded from change
identity: retrying the same logical comparison must not create a new event.
The digest window distinguishes an identical change observed in a later period.
