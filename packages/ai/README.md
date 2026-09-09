# AI boundary

This package keeps probabilistic interpretation separate from deterministic product behavior.

- `IntentInterpreter` is provider-neutral.
- `OpenAIIntentInterpreter` uses the Responses API with strict JSON Schema output, server-only credentials, an explicit timeout, `store: false`, and request-ID capture.
- `DeterministicIntentInterpreter` handles common Argentine real-estate language without network access.
- `createResilientIntentInterpreter` falls back locally when a provider is unavailable or returns invalid structured data.
- Every result is validated against the shared runtime contract and sets `requiresConfirmation: true`.

AI never schedules jobs, persists monitors, applies hard constraints, or decides whether an operation succeeded.

The current model and prompt are configured through `OPENAI_MODEL` and the package source. Model upgrades require the intent evals and integration suite to pass.
