import { terminalMission, canCallYourself } from './lib/mission-store.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const labels = { queued: 'Queued', dialing: 'Dialing — no answer confirmed yet', speaking: 'Speaking with the restaurant', waiting: 'Waiting for evidence', needs_input: 'Needs your answer', completed: 'Work completed', failed: 'Could not finish', canceling: 'Stop requested — awaiting confirmation', canceled: 'Stopped' }
const time = (value) => {
  const date = new Date(typeof value === 'number' ? value * 1000 : value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Time unavailable'
}
function sourceLink(source) {
  try {
    const u = new URL(source?.url)
    if (!['https:', 'http:'].includes(u.protocol)) return ''
    return '<a href="' + esc(u.href) + '" target="_blank" rel="noopener noreferrer">Source: ' + esc(u.hostname) + '</a>' + (source.checkedAt ? ' · checked ' + esc(time(source.checkedAt)) : '')
  } catch { return '' }
}
function quotesHtml(quotes = []) {
  return quotes.map((q) => '<blockquote><span>' + (q.role === 'user' ? 'Restaurant' : q.role === 'agent' ? 'Assistant' : 'Speaker unavailable') + ' · ' + (Number.isFinite(q.t) && q.t >= 0 ? esc(q.t) + 's' : 'Time unavailable') + '</span><p>' + esc(q.text) + '</p></blockquote>').join('')
}
function evidenceHtml(evidence = []) {
  return evidence.map((e) => '<section class="mission-evidence"><strong>' + esc(e.restaurant) + '</strong><p>' + sourceLink(e.source) + '</p><p>OS3 reported: availability ' + esc(e.merchant?.availability || 'unknown') + '; reservation ' + esc(e.merchant?.reservation || 'unconfirmed') + '.</p>' + quotesHtml(e.quotes) + '</section>').join('')
}
function outcomeHtml(m) {
  let html = m.discoveryNote ? '<p>' + esc(m.discoveryNote) + '</p>' : ''
  for (const place of m.destinations) {
    const call = [...(place.attempts || [])].reverse().find((a) => a.call)?.call
    html += '<section class="mission-destination"><h4>' + esc(place.name) + '</h4><p>' + sourceLink(place.source) + '</p>'
    if (call) html += '<p>Call: ' + esc(call.state.replaceAll('_', ' ')) + (call.reconciling ? ' · reconciling uncertain dispatch' : '') + '. OS3 reported: availability ' + esc(call.merchant?.availability || 'unknown') + '; reservation ' + esc(call.merchant?.reservation || 'unconfirmed') + '.</p><p>' + esc(call.summary || call.failure || 'No merchant answer verified yet.') + '</p>' + quotesHtml(call.evidence)
    else html += '<p>' + (place.attempts?.length ? 'Call request recorded; awaiting its outcome.' : 'Sourced destination; no call outcome yet.') + '</p>'
    html += '</section>'
  }
  if (m.answer) html += '<div class="mission-answer"><p>' + esc(m.answer.text) + '</p><p class="mission-note">' + esc(m.answer.uncertainty) + '</p>' + evidenceHtml(m.answer.evidence) + '</div>'
  if (m.error) html += '<p role="status">' + esc(String(m.error).replaceAll('_', ' ')) + '</p>'
  return html
}

export function mountMissions(root, controller) {
  root.innerHTML = '<div class="mission-session"><span data-account></span><button class="chip" data-sign-in hidden>Sign in with Google</button><button class="chip" data-switch hidden>Switch account</button><button class="chip" data-refresh hidden>Refresh results</button></div><p class="mission-note" data-network></p><p role="status" aria-live="polite" data-notice></p><div data-google></div><div data-pending></div><section data-results aria-label="Concierge requests"></section>'
  const googleHost = root.querySelector('[data-google]')
  const cards = new Map()
  let painting = false
  let shownAccount = null
  const fail = (error) => { controller.notice = error.message; controller.emit() }
  const paint = () => {
    if (painting || !root.isConnected) return
    painting = true
    try {
      const state = controller.state()
      root.querySelector('[data-notice]').textContent = state.error || state.notice
      root.querySelector('[data-network]').textContent = state.online ? 'Missions run through OS3 staging. Sources and the last known outcomes are saved here.' : 'Offline — showing saved outcomes. Unsent requests and answers stay on this device; an accepted mission may continue within its original limits.'
      if (state.error) return
      const { identity, journal, authenticated } = state
      if (identity.accountId !== shownAccount) { root.querySelector('[data-results]').replaceChildren(); cards.clear(); shownAccount = identity.accountId }
      root.querySelector('[data-account]').textContent = identity.accountId ? (authenticated ? 'Signed in · ' : 'Saved for ') + identity.label : ''
      root.querySelector('[data-switch]').hidden = !authenticated
      root.querySelector('[data-sign-in]').hidden = authenticated || (!identity.accountId && !identity.submission && !controller.authWanted)
      root.querySelector('[data-refresh]').hidden = !journal.missions.length
      googleHost.hidden = authenticated || !state.online
      const staged = identity.submission && (!identity.submission.accountId || identity.submission.accountId === identity.accountId) ? [{ body: identity.submission.request, kind: 'create', attempted: false }] : []
      root.querySelector('[data-pending]').innerHTML = [...staged, ...journal.pending.filter((p) => p.kind === 'create')].map((p) => '<article class="mission-card"><p class="mission-prompt">' + esc(p.body.prompt) + '</p><strong>' + (p.rejected ? 'OS3 could not accept these instructions. They remain saved; submit a corrected request in the prompt.' : p.attempted ? 'Request sent; awaiting confirmation. Reconnect uses this same request.' : 'Saved on this device; not yet confirmed by OS3.') + '</strong></article>').join('')
      const visibleIds = new Set(journal.missions.map((m) => m.id))
      for (const [id, entry] of cards) if (!visibleIds.has(id)) { entry.node.remove(); cards.delete(id) }
      for (const m of [...journal.missions].sort((a, b) => b.createdAt - a.createdAt)) {
        let entry = cards.get(m.id)
        if (!entry) {
          const node = document.createElement('article')
          node.className = 'mission-card'; node.dataset.mission = m.id
          node.innerHTML = '<p class="mission-prompt" data-prompt></p><p><strong data-state></strong></p><p class="mission-note" data-updated></p><div data-outcome></div><div data-questions></div><div data-local></div><button class="chip" data-cancel>Stop this request</button><div data-takeover></div><details data-history><summary>Earlier updates</summary><div></div></details>'
          root.querySelector('[data-results]').append(node)
          entry = { node, revision: 0, question: null, account: identity.accountId }; cards.set(m.id, entry)
        }
        const node = entry.node
        node.dataset.revision = String(m.revision)
        node.querySelector('[data-state]').textContent = labels[m.state]
        node.querySelector('[data-updated]').textContent = 'Last known update: ' + time(m.updatedAt) + (m.authority?.commitment === 'information_only' ? ' · information only; no booking requested' : '')
        if (entry.revision !== m.revision) {
          node.querySelector('[data-prompt]').textContent = m.prompt
          node.querySelector('[data-outcome]').innerHTML = outcomeHtml(m)
          node.querySelector('[data-history]').hidden = !m.history?.length
          node.querySelector('[data-history] div').innerHTML = (m.history || []).map((h) => '<section><p>' + esc(time(h.updatedAt)) + ' · ' + esc(labels[h.state]) + '</p>' + outcomeHtml(h) + (h.needs || []).map((n) => '<p>' + esc(n.question) + '</p>').join('') + '</section>').join('')
          entry.revision = m.revision
        }
        const pending = journal.pending.filter((p) => p.subject === m.id || p.subject.startsWith(m.id + '/'))
        node.querySelector('[data-local]').textContent = pending.map((p) => p.rejected ? 'OS3 could not accept an earlier update. Its original instructions remain saved; review the latest question or result.' : p.kind === 'cancel' ? 'Stop saved on this device; awaiting delivery and confirmation. The mission may still be running.' : 'Your answer is saved; awaiting delivery and confirmation.').join(' ')
        node.querySelector('[data-cancel]').hidden = terminalMission(m) || m.state === 'canceling' || pending.some((p) => p.kind === 'cancel' && !p.rejected)
        const phones = m.destinations.filter((p) => /^\+[1-9]\d{6,14}$/.test(p.phone || '') && sourceLink(p.source))
        const ready = canCallYourself(m) && !pending.some((p) => p.kind === 'cancel' && !p.rejected)
        node.querySelector('[data-takeover]').innerHTML = phones.length ? '<p class="mission-note">' + (ready ? 'AI work has ended. You can call the restaurant yourself.' : 'To take over, stop this request. Phone links unlock after confirmed termination; this is not a live transfer.') + '</p>' + phones.map((p) => ready ? '<p><a href="tel:' + esc(p.phone) + '">Call ' + esc(p.name) + ' yourself · ' + esc(p.phone) + '</a></p>' : '<p>Call ' + esc(p.name) + ' yourself · ' + esc(p.phone) + ' · awaiting termination</p>').join('') : ''
        const q = m.needs?.[0]
        const questionKey = q ? q.id : null
        if (entry.question !== questionKey) {
          node.querySelector('[data-questions]').innerHTML = q ? '<form data-answer><label><span data-question></span><textarea rows="2" maxlength="2000" required></textarea></label><button class="chip" type="submit">Send answer</button></form>' : ''
          if (q) {
            node.querySelector('[data-question]').textContent = q.question
            const input = node.querySelector('textarea'); input.setAttribute('aria-label', q.question)
            input.value = journal.replies[m.id + '/' + q.id] || ''
          }
          entry.question = questionKey
        }
        entry.mission = m
        const form = node.querySelector('[data-answer]')
        if (form) form.querySelector('button').disabled = pending.some((p) => !p.rejected && p.kind === 'answer' && p.subject === m.id + '/' + q.id)
      }
      if (!authenticated && controller.authWanted && state.online && !controller.authFlight && (!controller.challenge || controller.challenge.expiresAt <= Date.now() || !googleHost.childElementCount)) void controller.signIn(googleHost)
    } finally { painting = false }
  }
  const click = (event) => {
    const button = event.target.closest('button')
    if (!button) return
    if (button.hasAttribute('data-sign-in')) { controller.authWanted = true; void controller.signIn(googleHost, true) }
    if (button.hasAttribute('data-switch')) { controller.signOut(); controller.authWanted = true; void controller.signIn(googleHost, true) }
    if (button.hasAttribute('data-refresh')) {
      if (controller.client.identity) void controller.sync()
      else { controller.authWanted = true; void controller.signIn(googleHost, true) }
    }
    if (button.hasAttribute('data-cancel')) {
      const mission = cards.get(button.closest('[data-mission]').dataset.mission)?.mission
      if (mission) void controller.cancel(mission).catch(fail)
    }
  }
  const submit = (event) => {
    if (!event.target.matches('[data-answer]')) return
    event.preventDefault()
    const entry = cards.get(event.target.closest('[data-mission]').dataset.mission)
    void controller.answer(entry.mission, entry.mission.needs[0], event.target.querySelector('textarea').value).catch(fail)
  }
  const input = (event) => {
    if (!event.target.matches('[data-answer] textarea')) return
    const entry = cards.get(event.target.closest('[data-mission]').dataset.mission)
    void controller.saveReply(entry.mission.id, entry.mission.needs[0].id, event.target.value).catch(fail)
  }
  root.addEventListener('click', click); root.addEventListener('submit', submit); root.addEventListener('input', input)
  const unsubscribe = controller.subscribe(paint)
  paint()
  return () => { unsubscribe(); root.removeEventListener('click', click); root.removeEventListener('submit', submit); root.removeEventListener('input', input) }
}
