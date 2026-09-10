# Set up restaurant voice

**First voice release: [OS3 staging](https://staging.os.unitary.com).**
The normal Concierge prompt talks directly to the staging mission service.
Configure and test staging first; production needs a separate reviewed OS3
promotion and deployment. Existing manual voice reports keep their original
OS3 destination.

**You pay the providers directly.** Concierge never asks you to paste an API
key. The keys belong in the OS3 server's private environment configuration.

## Which accounts do I need?

| What you want | Accounts |
| --- | --- |
| Compose a natural phrase and translate a staff reply into English | Anthropic API for text; ElevenLabs for transcribing audio |
| Play natural speech | ElevenLabs, plus Anthropic if OS3 composes/translates the phrase |
| Have OS3 phone a restaurant | ElevenLabs Agents, Twilio, and Anthropic API |
| Read a previously saved phrase/report or play a matching device voice | No additional paid account; device voice quality/availability varies |

**ElevenLabs** supplies speech, transcription, and the conversational phone
agent. Create an API account/workspace, choose voices suitable for the staff's
language, and add billing. For calls, create the restaurant agent and import
your Twilio number. [API pricing](https://elevenlabs.io/pricing/api) ·
[Twilio integration](https://elevenlabs.io/docs/agents-platform/phone-numbers/twilio-integration/native-integration).

**Twilio** supplies the caller number and phone network. Upgrade from the trial
for calls to ordinary restaurant numbers; trial destinations are restricted.
Buy a voice-capable number you are eligible to use, or verify an existing number
you control as an outbound caller ID and import it into ElevenLabs. A verified
caller ID supports outbound calls only. Enable only your intended destination
countries in Voice geographic permissions. A local Spanish number is not
required simply to dial Spain. Twilio may require identity or address documents
for a purchased number. Create a separate server API key
for OS3's hangup control. The carrier bill is separate from ElevenLabs.
[Voice pricing by country](https://www.twilio.com/en-us/voice/pricing) ·
[Geographic permissions](https://www.twilio.com/docs/voice/api/dialing-permissions-resources).

**Anthropic API** supplies phrase composition, translation, and the English
call summary. Create an API account with billing and an API key. A consumer
chat subscription is not the API billing account. The text model is configured
on the OS3 server. [Console](https://console.anthropic.com/) ·
[Pricing](https://www.anthropic.com/pricing).

No OpenAI account is required by the agreed default implementation. Provider
prices, country rules, number availability, and plan limits can change; check
the linked official pages before purchase.

## Operator setup

The complete configuration, exact agent prompt, variables, callback URL and
rollout instructions live in the
[OS3 account guide](https://github.com/unitary-internal/unitary-os3/blob/staging/docs/specs/restaurant-voice-accounts.md).

- Put provider secrets only in the OS3 server EnvironmentFile.
- Disable agent audio saving and carrier recording. OS3 checks privacy before
  each dial. Set transcript retention deliberately; providers process speech
  and restaurant/customer details to perform the task.
- Configure the signed post-call webhook on the existing OS3 HTTPS origin.
- Configure maximum call duration, daily call limits, and destination countries.
  Billing alerts are useful, but are not a substitute for enforced app limits.
- Configure Twilio hangup credentials. Calls stay disabled without cancellation.
- Test through the existing staging deployment before enabling production.
- On the existing Google OAuth web client, verify **Authorized JavaScript
  origins** includes `https://bloklabs.github.io`. Keep that exact origin in
  OS3's allowed Concierge origins, derived from `VOICE_HANDOFF_TARGETS`. The
  public client ID is not a secret. No Google client secret belongs in Pages.
  The server issues a single-use nonce challenge and a ten-minute bearer usable
  only for Concierge missions; the browser keeps credentials only in memory.
  [Google setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Use it on your phone

1. Type your request into the **normal Concierge prompt**, then send it. For
   example: “Call three nearby restaurants, check vegetarian dinner for four at
   20:15 tonight, and report back.” Known location, preferences and saved source
   references accompany the request; include missing details naturally in text.
2. Sign in with Google when needed. Your submitted request is kept while you
   sign in and resumes automatically. Never copy an API key or sign-in token.
3. Watch sourced destinations, call progress and results **in the same page**.
   Answer a consequential missing question inline. There is no second mission
   confirmation or mandatory phone-number/language form.
4. Use **Stop this request** to stop further work. While offline, the stop intent
   is saved locally and explicitly awaits delivery; an accepted mission can
   still be running. Reconnect restores the exact pending request and key.

Ordinary place names, pasted links and autocomplete selections still save places.
The **Voice** tab retains manual in-person speech tools and earlier imported
reports. Those tools can still open OS3 and return a phrase/report, but they are
optional and are not the restaurant-mission entry point.

Saved results stay readable offline. Concierge labels call outcomes
**OS3 reported** with time and evidence; an ended call does not establish that
food remains or a table was booked. Missions refresh their current records while
connected; offline snapshots keep the last known state, evidence and earlier
updates. Google sign-in and real paid calls are not established by fixture tests.

## First paid test

Use **your own authorized phone** before calling a restaurant. Check speech
naturalness with a fluent speaker, names, numbers, interruption handling,
translation, no answer, voicemail, duration cutoff, and cancellation. Confirm
that no audio recording was retained. Only then make a real restaurant request.

Automated tests use deterministic data and do not prove a voice sounds natural
or that a carrier can connect to a particular restaurant.
