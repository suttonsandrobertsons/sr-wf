// Normalisation: parsing and arithmetic over free input.
//
// No business decisions here. These reshape what the customer typed into what
// Zoho needs. They cannot be Designer markup, because the input space is
// unbounded. Decisions live in ./business-rules.js.

import { formValues } from '../core/values.js'

/** `YYYY-MM-DD`, or '' when the value is not a real calendar date. */
export function formatDate(value) {
  const date = String(value || '').trim()
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return ''

  return `${match[1]}-${match[2]}-${match[3]}`
}

/** `HH:mm:ss`, or '' when the value is not a real time of day. */
export function formatTime(value) {
  const time = String(value || '').trim()
  const match = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return ''

  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] || 0)
  if (hour > 23 || minute > 59 || second > 59) return ''

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

// Adds `minutes` to `YYYY-MM-DD` + `HH:mm:ss`, returns `YYYY-MM-DDTHH:mm:ss`.
// UTC is used only for day-rollover arithmetic; no timezone shift is applied.
export function addMinutes(date, time, minutes) {
  const pad = (n) => String(n).padStart(2, '0')
  const [Y, Mo, D] = date.split('-').map(Number)
  const [h, m, s] = time.split(':').map(Number)

  let total = h * 60 + m + minutes
  const dayShift = Math.floor(total / 1440)
  total = ((total % 1440) + 1440) % 1440
  const eh = Math.floor(total / 60)
  const em = total % 60

  const d = new Date(Date.UTC(Y, Mo - 1, D))
  d.setUTCDate(d.getUTCDate() + dayShift)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(eh)}:${pad(em)}:${pad(s || 0)}`
}

function fieldType(control) {
  return String(
    control.closest('[data-form-field-type]')?.getAttribute('data-form-field-type')
    || control.getAttribute('data-form-field-type')
    || '',
  ).trim().toLowerCase()
}

function fieldKey(control) {
  return String(
    control.closest('[data-form-field]')?.getAttribute('data-form-field')
    || control.getAttribute('data-form-field')
    || control.name
    || '',
  ).trim()
}

/**
 * Writes <key>_formatted beside every date and time control.
 *
 * @param {(name: string, value: string) => void} write
 */
export function writeFormattedFields(root, write) {
  root.querySelectorAll('input, select, textarea').forEach((control) => {
    const type = fieldType(control)
    if (type !== 'date' && type !== 'time') return

    const key = fieldKey(control)
    if (!key) return

    write(`${key}_formatted`, type === 'date' ? formatDate(control.value) : formatTime(control.value))
  })
}

/**
 * Zoho meetings need a start and a mandatory end datetime.
 *
 * Depends on appointment_length, which a business rule sets, so this runs
 * after the rules. Reorder them and every end datetime goes empty.
 *
 * Reads via get(), which skips condition-hidden controls. Note the date and
 * time wrappers carry an EMPTY data-form-show-if on the live pages, so they
 * are always shown — a previous comment here claimed the home-visit path
 * emits nothing, which is false.
 */
export function writeAppointmentDatetimes(root, write) {
  const date = formatDate((formValues.get(root, 'appointment_date')[0] || '').trim())
  const time = formatTime((formValues.get(root, 'appointment_time')[0] || '').trim())

  if (!date || !time) {
    write('appointment_start_datetime', '')
    write('appointment_end_datetime', '')
    return
  }

  write('appointment_start_datetime', `${date}T${time}`)

  const length = parseInt((formValues.get(root, 'appointment_length')[0] || '').trim(), 10)
  write('appointment_end_datetime', Number.isFinite(length) ? addMinutes(date, time, length) : '')
}
