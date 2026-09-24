// Values the bundle decides and submits for the customer.
//
// Split by what the code does:
//
//   ./business-rules.js   one outcome chosen from enumerable answers
//   ./format-datetime.js  parsing and arithmetic over free input
//
// Not here: environment capture (first_page, GCLID, lead_reference) is in
// core/attribution.js. Gold money and per-slot fields are in gold.js.

import { formConfig } from '../config.js'
import { formValues } from '../core/values.js'
import { escapeSelector } from '../../../utils/dom.js'
import { BUSINESS_RULES } from './business-rules.js'
import { writeAppointmentDatetimes, writeFormattedFields } from './format-datetime.js'

// Rename any control that still carries this name in the Designer markup.
// Renaming is the only way to remove a key: Webflow submits disabled controls.
// The renamed control submits as _disabled_<name>.
function neutraliseLegacyControls(root, name) {
  const prefix = formConfig.submit?.unsubmittedNamePrefix || '_disabled_'

  root.querySelectorAll(`[name="${escapeSelector(name)}"]`).forEach((control) => {
    if (control.getAttribute('data-form-owned-value') === 'true') return
    control.setAttribute('data-form-submit-original-name', name)
    control.setAttribute('name', `${prefix}${name}`)
  })
}

/**
 * Write a value under a name this code owns.
 *
 * Neutralise first, always, even when the rule returns null. Otherwise the
 * Designer inputs keep their names and Webflow submits the last one (e.g.
 * box_and_papers = "None" on a get-a-quote lead that never asked).
 *
 * setHidden alone is not enough: it reuses the first existing input with the
 * name instead of appending, so the result would depend on markup order.
 *
 * @param {string|null} value null removes the key.
 */
function ownField(root, name, value) {
  neutraliseLegacyControls(root, name)

  const owned = root.querySelector(
    `input[name="${escapeSelector(name)}"][data-form-owned-value="true"]`,
  )

  if (value === null) {
    // Remove a value an earlier pass wrote, so the key is absent rather than
    // stale after the customer changes an answer.
    owned?.remove()
    return null
  }

  const hidden = formValues.setHidden(root, name, value || '')
  hidden.setAttribute('data-form-owned-value', 'true')
  return hidden
}

export const formSubmitValues = {
  // Runs at submit only. See core/events.js.
  apply(root) {
    if (!root?.querySelectorAll) return

    const write = (name, value) => ownField(root, name, value)

    writeFormattedFields(root, write)

    // Order matters. writeAppointmentDatetimes reads appointment_length, which
    // a rule sets. Every rule runs, including the ones that return null,
    // because ownField still has to neutralise the Designer inputs.
    BUSINESS_RULES.forEach(([name, compute]) => write(name, compute(root)))

    writeAppointmentDatetimes(root, write)
  },
}

export { formatDate, formatTime, addMinutes } from './format-datetime.js'
