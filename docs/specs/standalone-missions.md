# Standalone Concierge missions

Agreed with the OS3 backend owner on 2026-09-10. Implements the standalone
client of the [approved native mission design](https://github.com/unitary-internal/unitary-os3/blob/696eae0677a9a89cc6171d59657dbe98f592430e/docs/specs/native-concierge-voice.md).

The normal Concierge prompt submits a bounded request directly to OS3. Known
location, preferences and saved source references accompany it. OS3 discovers
contacts and languages, owns call execution, and asks only consequential missing
questions. No phone/locale form, Voice detour, credential copy or second mission
confirmation is required. Existing capture, navigation, saved places and manual
voice reports remain available.

Authentication uses Google Identity Services, a single-use origin-bound server
challenge, and a ten-minute mission-only bearer. The browser sends no OS3 cookies.
The Google credential and bearer stay in memory. Verified account identity scopes
the offline journal; a different account cannot replay an earlier account's intent.

- `POST /v1/concierge/auth/challenge` returns `challengeId`, `nonce`, `clientId`,
  `expiresIn:300`. Pass the nonce to GIS.
- `POST /v1/concierge/auth/exchange` accepts `{challengeId,credential}` and returns
  `{accessToken,accountId,email,expiresAt,scope:"concierge:missions"}`. Times are Unix seconds.
- Mission requests use `credentials:"omit"`, `Authorization`, `X-OS3-Account`,
  and a stable `Idempotency-Key` for mutations. CORS is exact-origin and restricted
  to Concierge routes. The backend owns token verification and route isolation.

Known saved references use `context.savedPlaces:[{id?,name,city?,notes?,sourceUrls?}]`,
matching the backend contract. Saved places alone do not establish current location
or authorize a call. The backend resolves contacts and enforces prompt authority.

Before dispatch, atomically persist the exact request and key under a Web Lock.
Keep ambiguous requests for same-key reconciliation. Answer/cancel intent is also
durable. Save response and remove its pending intent in one write. Never silently
reset or trim a journal after corruption, quota failure, offline transition, or
an empty server list. Preserve earlier evidence when a newer snapshot changes it.
Monotonic revisions cannot overwrite newer results with stale responses.

Inline status separates queued, dialing, speaking, waiting, needs input, completed,
failed, canceling and canceled. Show sourced destinations and OS3-reported quotes;
an ended call is not a reservation. Unknown quote times remain unknown. Pending
offline cancellation is clearly awaiting delivery. Polling and reauthentication
never grant fresh call or booking authority.

Acceptance covers the actual normal prompt, nonce-bound GIS callback, memory-only
tokens, inferred context, sourced incremental outcomes, staff answers, cancellation,
offline reload, same-key lost-response recovery, concurrent tabs, account switches,
failed persistence, stale revisions and untrusted result text. Paid provider and
real Google sign-in verification remain separate from deterministic test fixtures.

GIS implementation references, kept beside this contract:

- [JavaScript API and nonce](https://developers.google.com/identity/gsi/web/reference/js-reference)
- [Official popup button and credential callback](https://developers.google.com/identity/gsi/web/guides/display-button)

Delivery: reviewed client PR to `main`, exact-commit CI, Pages deployment, then
public version and phone-journey checks. Coordinate backend staging readiness
with the existing OS3 lane; no backend edits or deployment from this client lane.
