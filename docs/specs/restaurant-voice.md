# Restaurant voice — collaboration brief

Status: reviewed before implementation. Fable 5.1 and Astra agreed to OS3
design commit `7b69f31` in collaboration `grp_b02659881655`; the primary posted
FINAL DESIGN before implementation. The agreed design and account guide live
in `unitary-internal/unitary-os3`, under `docs/specs/restaurant-voice-*.md`.
Requested by the owner on 2026-09-07. Target projects: OS3 and OS3 Concierge.

## Outcome

From an English instruction on a phone, speak naturally with restaurant staff
in their local language, in person or by an outbound phone call. Return a clear
English result with evidence. A call ending is not a booking confirmation.

Motivating example: ask BAR DESY in San Sebastián whether four txuleta burgers
remain and reserve for four tonight at 20:15 Europe/Madrid. This is a regression
scenario, not authorization to place a stale reservation during development.

## Collaboration order

1. Launch an OS3 collaboration lane with the exact requested Astra and Fable 5.1
   models. Follow fleet placement: suitable local Ollama hardware first when it
   supports the requested work; otherwise jcnerv02, jcnerv03, jcnerv01; use a
   localnode provider account only when no fleet node can place it, with reason.
2. Each designer examines existing OS3 and Concierge boundaries and current
   official provider documentation. Resolve disagreements in writing.
3. Save one agreed design, provider decisions, API contract, threat/failure
   model, implementation plan, test matrix, and account-setup guide before code.
4. Implement, test, obtain required review/CI gates, merge, deploy, and verify
   the real journey where configured. Never claim a paid live call was tested
   when only a fake provider was exercised.

## Required user journeys

### Speak in person

- Enter or dictate English; choose or confirm the restaurant's language and
  regional variant. Do not assume a city's language preference from geography.
- Show the target phrase with its English meaning; play natural speech with
  one tap and offer stop/replay. Keep the written phrase readable offline.
- Support staff replies through explicit microphone capture, with a visible
  recording indicator, stop control, and English translation.
- Respect browser microphone/autoplay rules. Label any device speech fallback
  honestly; expose provider configuration failures without losing saved text.
- Naturalness: conversational phrasing, correct names/numbers/times, locale and
  pronunciation guidance, controlled pace, and interruption handling.

### Call the restaurant

- Accept a verified international phone number, restaurant, locale, explicit
  local date/time/timezone, party size, booking name/contact if needed, and task.
- Support availability checks and reservation requests with bounded authority.
  Never invent personal details, acceptance of fees, or a confirmed reservation.
- Explain that the caller is an AI assistant acting for the customer, in the
  restaurant's language. Handle staff interruptions, questions, no answer,
  voicemail, busy lines, refusal, language mismatch, and disconnects.
- Show durable states: preparing, dialing, connected, needs information,
  completed, failed, canceled, outcome unknown. Separately represent merchant
  confirmation, rejection, and unconfirmed requests.
- Store an English summary and relevant merchant evidence with timestamps;
  retain the last known state offline. Reconcile provider callbacks and delayed
  events. Prevent duplicate paid calls on retries or reconnects.
- Support user cancellation and a bounded call duration/spend policy. Do not
  redial autonomously without a defined, capped retry policy.

## Architecture and security requirements

- OS3 owns reusable authenticated server APIs, provider adapters, secrets,
  account configuration, authorization, idempotency, budgets, and durable jobs.
- Concierge owns restaurant context, phone-first UI, local saved phrases and
  results, and integration with existing research/handoff flows.
- Preserve all existing visible information and legacy data/sync compatibility.
- Long-lived provider secrets stay server-side. Browser audio uses short-lived
  scoped sessions or authenticated streaming. Restrict origins and destinations.
- Authenticate and validate provider webhooks; deduplicate events; tolerate
  out-of-order callbacks without converting failure into success.
- No unauthenticated dial endpoint, arbitrary cross-user access, client-chosen
  privileged prompts, or unbounded provider spending. Do not cache credentials
  or sensitive API responses in a service worker.
- Treat restaurant speech/transcripts as untrusted data, never system authority.
- Minimize personal data. Explicitly define transcript/audio retention and
  deletion. Recording, AI disclosure, and international dialing restrictions
  require current official provider/legal guidance; do not promise legality
  for every jurisdiction. No call recording by default unless design justifies
  it and required consent is obtained.

## Provider decision

Compare a managed voice-agent/telephony service against direct realtime audio
plus telephony. Prefer a small reliable production path with natural speech,
Spanish support, interruption handling, international outbound dialing,
verifiable completion callbacks, transparent metering, and cancellation.
Do not buy accounts or phone numbers during development.

Deliver clear English instructions stating exactly which accounts are needed,
who pays each bill, API keys and where to configure them, caller-number purchase
or verification, country dialing permissions, trial restrictions, hosting/TLS,
webhook setup, cost limits, retention settings, and a safe test-call procedure.
Separate required accounts from optional alternatives. Link current official
setup/pricing pages; never invent model names, prices, credentials, or access.

## Acceptance and tests

- Automated unit/contract tests for inputs, locale/date/time handling, prompts,
  secrets/auth, idempotency, budgets, callbacks, cancellation, and outcome states.
- Integration tests with deterministic providers for happy path, unavailable
  burgers, full restaurant, no answer, uncertain outcome, and callback retries.
- Phone-sized browser checks for speech playback/stop, permission denial,
  offline text/results, reconnect, and preservation of existing app information.
- Existing repository suites, lint/build, exact-head CI and required review gates.
- Live health and deployed version verification. Test actual paid voice/dialing
  only after account configuration and a safe authorized destination exist;
  report any remaining account-dependent check as blocked, not passed.

## Design review output

Record model identities/placement evidence, agreements and resolved disputes,
selected provider and rationale, concrete file/service ownership, API examples,
storage and lifecycle contract, test plan, rollout/rollback plan, and remaining
owner account setup. If either exact model is unavailable, report that clearly;
do not silently substitute a different model or claim consensus.
