// Export blurbs: concise, structured text a human OR agent concierge can act on
// directly — no app context required. Used by the "Copy for concierge" buttons.

import { CATEGORY_META } from './normalize.js'
import { formatDuration } from './transit.js'

/** A single-option blurb to hand off for one place/item. */
export function itemBlurb(item) {
  const meta = CATEGORY_META[item.category || 'other']
  const lines = []
  lines.push(`${meta.emoji} ${item.title}`)
  const where = [item.city, item.country].filter(Boolean).join(', ')
  if (where) lines.push(`Location: ${where}`)
  lines.push(`Type: ${meta.label}`)
  if (item.snippet) lines.push(item.snippet)
  if (item.booking) {
    const b = item.booking
    const access = b.tier === 'concierge' ? 'Concierge / advance booking needed'
      : b.tier === 'reservation' ? 'Reservation recommended' : 'Walk-in friendly'
    lines.push(`Getting in: ${access} (difficulty ${b.score}/5)`)
  }
  if (item.hours) lines.push(`Opening hours: ${item.hours}`)
  if (item.costUsd != null) lines.push(`Est. cost: ~$${item.costUsd}${item.costRaw ? ` (${item.costRaw})` : ''} per person`)
  if (item.visitMin) lines.push(`Time to budget: ${formatDuration(item.visitMin)}`)
  if (item.reservation && item.reservation.required) {
    lines.push(`Reservation: REQUIRED — book ~${item.reservation.leadDays} days ahead. ${item.reservation.note || ''}`.trim())
  } else if (item.reservation && item.reservation.leadDays) {
    lines.push(`Reservation: recommended (~${item.reservation.leadDays} days ahead).`)
  }
  if (item.notes) lines.push(`Notes: ${item.notes}`)
  if (item.url) lines.push(`Link: ${item.url}`)
  lines.push('')
  lines.push('Please confirm availability, current pricing, and how to book. Flag anything time-sensitive.')
  return lines.join('\n')
}

/** A full day-plan blurb built from buildItinerary() output. */
export function itineraryBlurb(plan, meta = {}) {
  const lines = []
  const header = ['Trip plan request', meta.city && `— ${meta.city}`, meta.date && `(${meta.date})`]
    .filter(Boolean)
    .join(' ')
  lines.push(header)
  lines.push('')

  if (plan.stops.length) {
    lines.push('Proposed order for the day:')
    plan.stops.forEach((s, i) => {
      const cat = CATEGORY_META[s.item.category || 'other']
      const hop = s.hopFromPrev ? ` (${s.hopFromPrev.mode} ~${formatDuration(s.hopFromPrev.minutes)})` : ''
      lines.push(`${i + 1}. ${s.arriveLabel} — ${cat.emoji} ${s.item.title}${hop}`)
      if (s.item.url) lines.push(`   ${s.item.url}`)
    })
    lines.push('')
    const t = plan.totals
    lines.push(
      `Totals: ${t.stops} stops · ~${t.distanceKm} km · transit ${formatDuration(t.transitMin)} · visits ${formatDuration(t.visitMin)} · est. $${t.costUsd}. Ends ~${t.endLabel}.`
    )
  }

  if (plan.unlocated && plan.unlocated.length) {
    lines.push('')
    lines.push('Also on the wishlist (no fixed time / lodging):')
    plan.unlocated.forEach((it) => lines.push(`- ${CATEGORY_META[it.category || 'other'].emoji} ${it.title}${it.url ? ` — ${it.url}` : ''}`))
  }

  if (plan.reservations && plan.reservations.length) {
    lines.push('')
    lines.push('Needs advance booking:')
    plan.reservations.forEach((r) => lines.push(`- ${r.title} — book ~${r.leadDays} days ahead. ${r.note}`))
  }

  lines.push('')
  lines.push('Please optimise the order if you know better, confirm reservations, and return final timings + total cost.')
  return lines.join('\n')
}
