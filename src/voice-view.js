import {
  VOICE_LOCALES, OS3_ORIGINS, beginVoice, readVoice, saveVoiceDraft,
  importVoice, validateVoiceResult, deleteVoiceResult, callReportUrl, deviceVoice,
} from './lib/voice.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const words = (s) => String(s).replaceAll('_', ' ')

function resultHtml(saved) {
  let result
  try { result = { ...validateVoiceResult(saved), origin: saved.origin } }
  catch { return '<article class="voice-result"><p>A saved report could not be displayed. Its data is kept on this device.</p></article>' }
  const time = new Date(result.generatedAt).toLocaleString()
  let body
  if (result.kind === 'phrase') {
    const p = result.phrase
    body = `<p class="voice-target" lang="${esc(p.locale)}">${esc(p.target)}</p>
      <p><strong>English:</strong> ${esc(p.english)}</p>
      ${p.pronunciation.length ? `<p>${p.pronunciation.map(esc).join(' · ')}</p>` : ''}
      <button class="chip" data-voice-play="${esc(result.nonce)}">Play device voice (fallback)</button>`
  } else {
    const c = result.call
    let href = ''
    try { href = callReportUrl(result) } catch { /* preserve the report even if its saved origin is invalid */ }
    body = `<p><strong>OS3 reported: reservation ${esc(words(c.merchant.reservation))}.</strong></p>
      <p>Food availability: ${esc(words(c.merchant.availability))} · Call: ${esc(words(c.state))}${c.reconciling ? ' · Checking provider outcome' : ''}</p>
      ${c.merchant.confirmedLocalTime ? `<p>Reported time: ${esc(c.merchant.confirmedLocalTime)}${c.merchant.confirmedPartySize ? ` · Party of ${esc(c.merchant.confirmedPartySize)}` : ''}${c.merchant.confirmedName ? ` · ${esc(c.merchant.confirmedName)}` : ''}</p>` : ''}
      ${c.summary ? `<p>${esc(c.summary)}</p>` : ''}
      ${c.evidence.map((e) => `<blockquote><span>${esc(e.role === 'user' ? 'Restaurant' : 'AI assistant')} · ${esc(e.t)}s</span><p>${esc(e.text)}</p></blockquote>`).join('')}
      <p class="voice-note">Saved report from OS3. Current availability has not been checked by Concierge.</p>
      ${href ? `<a class="chip voice-link" href="${esc(href)}" rel="noreferrer">View current call in OS3</a>` : ''}`
  }
  return `<article class="voice-result">${saved.label ? `<h3>${esc(saved.label)}</h3>` : ''}<p class="voice-note">${result.kind === 'phrase' ? 'Phrase from OS3' : 'Call report from OS3'} · <time datetime="${esc(result.generatedAt)}">${esc(time)}</time></p>
    ${body}${result.truncated ? '<p>OS3 shortened this report. Open OS3 for the full record.</p>' : ''}
    <button class="mini voice-delete" data-voice-delete="${esc(result.nonce)}" aria-label="Delete this saved voice result">Delete saved result</button></article>`
}

export function mountVoice(view, { notice = '', origin = OS3_ORIGINS[0] } = {}) {
  let data, storageError = ''
  try { data = readVoice(localStorage) }
  catch (e) { data = { draft: {}, results: [] }; storageError = e.message }
  const d = data.draft
  view.innerHTML = `<section class="voice-page" aria-label="Restaurant voice">
    <h1>Speak & call</h1>
    <p>Speak naturally with restaurant staff in their language, or have OS3 call for you.</p>
    <p class="voice-note">Voice opens in OS3 with your usual sign-in. Review the details there before speaking or dialing.</p>
    <p id="voiceNetwork" class="voice-note"></p>
    <form id="voiceForm">
      <label>What would you like to say or ask? <textarea name="instruction" rows="3" maxlength="2000" required placeholder="Ask if four burgers are still available, and request a table for four at 20:15.">${esc(d.instruction)}</textarea></label>
      <label>Restaurant’s language <select name="locale">${VOICE_LOCALES.map(([tag, label]) => `<option value="${tag}"${(d.locale || 'es-ES') === tag ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <p class="voice-note">Choose the staff’s language. Available natural voices depend on your OS3 setup.</p>
      <div class="voice-fields"><label>Restaurant <input name="restaurantName" maxlength="200" value="${esc(d.restaurantName)}" autocomplete="off"></label>
      <label>City <input name="city" maxlength="120" value="${esc(d.city)}" autocomplete="off"></label></div>
      <label>Restaurant phone (optional) <input name="phone" type="tel" maxlength="32" value="${esc(d.phone)}" placeholder="+34…" autocomplete="off"></label>
      <div class="voice-actions"><button class="chip voice-primary" type="submit" value="speak">Speak in OS3</button><button class="chip" type="submit" value="call">Call in OS3</button></div>
    </form>
    <p id="voiceStatus" role="status" aria-live="polite">${esc(storageError || notice)}</p>
    <div class="voice-actions"><button class="chip" id="voiceStop" type="button">Stop playback</button>
      <a class="voice-link" href="https://github.com/bloklabs/os3-concierge/blob/main/docs/voice-setup.md" target="_blank" rel="noreferrer">Voice account setup</a></div>
    <p class="voice-note">AI-generated voice. Device playback is a fallback; voice quality and offline availability depend on your phone.</p>
    <details class="voice-import"><summary>Import a result copied from OS3</summary>
      <p>Paste the result into the same browser or installed app that started the request. Requests expire after 24 hours.</p>
      <form id="voiceImport"><label>Copied result <textarea name="result" rows="3" maxlength="11000" required></textarea></label><button class="chip" type="submit">Save result</button></form>
    </details>
    <h2>Saved phrases & call reports</h2>
    <p class="voice-note">Stored only on this device. Kept readable offline; not shared with your shared list.</p>
    <div id="voiceResults">${data.results.length ? data.results.map(resultHtml).join('') : '<p>No saved voice results yet. Use “Send to Concierge” in OS3 after speaking or calling.</p>'}</div>
  </section>`
  const form = view.querySelector('#voiceForm')
  const status = view.querySelector('#voiceStatus')
  let disposed = false
  const setStatus = (message) => { if (!disposed) status.textContent = message }
  const draft = () => ({ ...Object.fromEntries(new FormData(form)), ref: d.ref || 'voice' })
  const updateNetwork = () => {
    view.querySelector('#voiceNetwork').textContent = navigator.onLine
      ? 'New natural speech and calls use the internet. Your saved text stays here.'
      : 'Offline · saved text remains available. New natural speech and calls need a connection.'
  }
  updateNetwork()
  window.addEventListener('online', updateNetwork)
  window.addEventListener('offline', updateNetwork)
  form.addEventListener('input', () => {
    try { saveVoiceDraft(localStorage, draft()) } catch (e) { setStatus(e.message) }
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    try {
      if (!navigator.onLine) throw new Error('Connect to the internet to open OS3. Your draft is saved here.')
      const url = beginVoice(localStorage, { ...draft(), mode: event.submitter?.value || 'speak' }, { origin })
      window.location.assign(url)
    } catch (e) { setStatus(e.message) }
  })
  view.querySelector('#voiceImport').addEventListener('submit', (event) => {
    event.preventDefault()
    try {
      importVoice(localStorage, new FormData(event.target).get('result'))
      view.querySelector('#voiceResults').innerHTML = readVoice(localStorage).results.map(resultHtml).join('')
      event.target.reset()
      setStatus('OS3 report saved on this device.')
    } catch (e) { setStatus(e.message) }
  })
  const stop = () => { globalThis.speechSynthesis?.cancel() }
  view.querySelector('#voiceStop').addEventListener('click', () => { stop(); setStatus('Playback stopped.') })
  view.querySelector('#voiceResults').addEventListener('click', (event) => {
    const play = event.target.closest('[data-voice-play]')
    const remove = event.target.closest('[data-voice-delete]')
    try {
      if (remove) {
        stop()
        deleteVoiceResult(localStorage, remove.dataset.voiceDelete)
        const results = readVoice(localStorage).results
        view.querySelector('#voiceResults').innerHTML = results.length ? results.map(resultHtml).join('') : '<p>No saved voice results.</p>'
        setStatus('Saved result deleted from this device.')
      }
      if (play) {
        const result = readVoice(localStorage).results.find((r) => r.nonce === play.dataset.voicePlay)
        const phrase = validateVoiceResult(result).phrase
        const voice = globalThis.speechSynthesis && deviceVoice(speechSynthesis.getVoices(), phrase.locale)
        if (!voice) throw new Error('No matching device voice is ready. Try again after voices load, or use natural speech in OS3. The written phrase stays available.')
        stop()
        const utterance = new SpeechSynthesisUtterance(phrase.target)
        utterance.voice = voice; utterance.lang = phrase.locale; utterance.rate = 0.9
        utterance.onerror = () => setStatus('Device playback failed. The written phrase stays available.')
        utterance.onend = () => setStatus('Playback finished. Tap Play to replay.')
        speechSynthesis.speak(utterance)
        setStatus('Playing device voice (fallback).')
      }
    } catch (e) { setStatus(e.message) }
  })
  return () => {
    disposed = true; stop()
    window.removeEventListener('online', updateNetwork)
    window.removeEventListener('offline', updateNetwork)
  }
}
