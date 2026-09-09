import { formValues } from './core/fields.js'

// This file's name is misleading and SIMPLE.md explains why: "derived" covers
// four different kinds of hidden field, and only two of them are business
// rules. What lives HERE is:
//
//   NORMALISED  `<key>_formatted`, appointment_start_datetime,
//               appointment_end_datetime — parsing and minute arithmetic over
//               free input. Cannot be expressed as Designer markup.
//   DECIDED     New_Lead_Type, combined_asset_type — outcomes chosen from
//               enumerable answers.
//
// Do NOT move New_Lead_Type to a Designer truth table. It was authored that way
// once, as four same-named hidden inputs, and could only ever carry ONE lead
// type: the singleValueFieldNames dedup submits exactly one control of a
// same-named group, and this value accumulates ("SHP Customer, Loan Customer,
// Consignment Customer"). One row per COMBINATION would work but grows
// combinatorially — two follow-ups is five rows, a third would be nine — where
// the code below handles any number. See docs/developer/form-behaviour.md
// section 7 in the private repository for the five combining mechanisms and
// which to reach for.
//
// What does NOT live here, despite sounding like it should: environment capture
// (first_page, GCLID, lead_reference and friends — core/conditions.js) and all
// gold money (gold.js). Look there first.
//
// If the two DECIDED fields ever move to the Designer, what remains is date and
// time formatting, and this file should be renamed for that rather than kept as
// a home for leftovers.

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

function setHidden(root, name, value) {
  formValues.setHidden(root, name, value || '')
}

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

export const formDerivedFields = {
  apply(root) {
    if (!root?.querySelectorAll) return

    root.querySelectorAll('input, select, textarea').forEach((control) => {
      const type = fieldType(control)
      if (type !== 'date' && type !== 'time') return

      const key = fieldKey(control)
      if (!key) return

      const value = type === 'date' ? formatDate(control.value) : formatTime(control.value)
      setHidden(root, `${key}_formatted`, value)
    })

    deriveCombinedAssetType(root)
    deriveAppointmentDatetimes(root)
    deriveNewLeadType(root)
  },
}

// Zoho meetings need a start AND a mandatory end datetime
// (`YYYY-MM-DDTHH:mm:ss`), from the appointment date + time and the gated
// `appointment_length` minutes. Reads via get(), so the home-visit path
// (date/time condition-hidden) yields nothing and no datetimes are emitted.
function deriveAppointmentDatetimes(root) {
  const dateStr = (formValues.get(root, 'appointment_date')[0] || '').trim()
  const timeStr = (formValues.get(root, 'appointment_time')[0] || '').trim()

  const date = formatDate(dateStr)             // '' unless valid YYYY-MM-DD
  const time = formatTime(timeStr)             // '' unless valid, normalised to HH:mm:ss
  if (!date || !time) {
    setHidden(root, 'appointment_start_datetime', '')
    setHidden(root, 'appointment_end_datetime', '')
    return
  }

  const start = `${date}T${time}`
  setHidden(root, 'appointment_start_datetime', start)

  const length = parseInt((formValues.get(root, 'appointment_length')[0] || '').trim(), 10)
  setHidden(root, 'appointment_end_datetime', Number.isFinite(length) ? addMinutes(date, time, length) : '')
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

// Zoho's New_Lead_Type is a multi-select: one comma-joined string, derived
// here because the Yes/No follow-ups make the outcome combinatorial.
// enquiry_type is matched exactly and case-sensitively (`Loan`, `Sell My
// Items`); the Yes/No follow-ups below are matched case-insensitively.
//
// Follow-ups are read only inside the Sell branch, so a Loan enquiry can't
// pick up a stale Yes. get() skips condition-hidden controls, so a hidden
// follow-up reads as unanswered.
//
// An unrecognised enquiry value writes empty rather than guessing.
function deriveNewLeadType(root) {
  const enquiry = (formValues.get(root, 'enquiry_type')[0] || '').trim()
  if (!enquiry) return

  const answeredYes = (name) => (formValues.get(root, name)[0] || '').trim().toLowerCase() === 'yes'
  const types = []

  if (enquiry === 'Loan') {
    types.push('Loan Customer')
  } else if (enquiry === 'Sell My Items') {
    // SHP Customer is the base for every sell lead (not conditional on the
    // follow-ups), so a lead answering No to both still sends a type.
    // AWAITING CLIENT CONFIRMATION: the spec only adds SHP alongside Loan
    // Customer when follow-up 1 is Yes.
    types.push('SHP Customer')
    if (answeredYes('enquiry_consider_loan')) types.push('Loan Customer')
    if (answeredYes('enquiry_consider_consignment')) types.push('Consignment Customer')
  }

  setHidden(root, 'New_Lead_Type', types.join(', '))
}

// Coalesces the asset picker for Zoho's Asset_Type: when asset_type is
// exactly "Other", takes the other_asset_types sub-type; otherwise the main
// category. Both already emit the exact Zoho option strings, so Zapier can
// map one field. other_asset_types reads empty when condition-hidden, so a
// stale sub-type can't leak through.
function deriveCombinedAssetType(root) {
  const assetType = (formValues.get(root, 'asset_type')[0] || '').trim()
  if (!assetType) return

  const otherType = (formValues.get(root, 'other_asset_types')[0] || '').trim()
  const combined = assetType === 'Other' ? otherType : assetType
  setHidden(root, 'combined_asset_type', combined)
}
