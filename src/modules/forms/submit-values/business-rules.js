// Business rules: one Zoho value chosen from enumerable answers.
//
// Do not move these back to Designer markup. The pattern was several same-named
// hidden <input>s gated by data-form-show-if. It cannot express "otherwise", so
// rows overlap and document order picks the winner. These strings are also no
// longer editable in the Designer, which is the accepted cost.

import { formValues } from '../core/values.js'

const get = (root, name) => (formValues.get(root, name)[0] || '').trim()
const isYes = (root, name) => get(root, name).toLowerCase() === 'yes'

// True when the question has a readable answer now. NOT "is on the form":
// get() returns nothing for an unanswered radio group or a hidden branch.
const isAnswered = (root, name) => formValues.get(root, name).length > 0

/**
 * Zoho New_Lead_Type: one comma-joined string for a multi-select.
 *
 * A truth table needs one row per combination, so this cannot be markup: two
 * follow-ups need five rows, a third needs nine.
 *
 * enquiry_type matches exactly and case-sensitively. The follow-ups match
 * case-insensitively and are read only in the Sell branch, so a Loan enquiry
 * cannot pick up a stale Yes.
 *
 * @returns {string|null} null when the form has no enquiry_type.
 */
export function computeNewLeadType(root) {
  const enquiry = get(root, 'enquiry_type')
  if (!enquiry) return null

  if (enquiry === 'Loan') return 'Loan Customer'

  if (enquiry === 'Sell My Items') {
    // SHP Customer is the base for every sell lead, so No to both still sends
    // a type. AWAITING CLIENT CONFIRMATION: the spec adds SHP only when
    // follow-up 1 is Yes.
    const types = ['SHP Customer']
    if (isYes(root, 'enquiry_consider_loan')) types.push('Loan Customer')
    if (isYes(root, 'enquiry_consider_consignment')) types.push('Consignment Customer')
    return types.join(', ')
  }

  // Unrecognised value: send an empty field, not no field. Empty reads as "not
  // classified"; absent reads as "the rule did not run".
  return ''
}

/**
 * Zoho Asset_Type: the sub-type when asset_type is "Other", else the category.
 *
 * Both sources emit exact Zoho option strings. other_asset_types reads empty
 * when condition-hidden, so a stale sub-type cannot leak through.
 */
export function computeCombinedAssetType(root) {
  const assetType = get(root, 'asset_type')
  if (!assetType) return null

  return assetType === 'Other' ? get(root, 'other_asset_types') : assetType
}

/**
 * get-a-quote: what the customer still has with the item.
 *
 * Do not remove the guard. This is the only rule with a default outcome, and
 * the two questions appear for some asset types only. Without the guard every
 * other lead sends box_and_papers = "None".
 *
 * A partial answer falls through to the 2x2, which is safe only because both
 * radios are required together.
 */
export function computeBoxAndPapers(root) {
  if (!isAnswered(root, 'original_box') && !isAnswered(root, 'original_paperwork')) return null

  const box = isYes(root, 'original_box')
  const papers = isYes(root, 'original_paperwork')

  if (box && papers) return 'Original Box and Papers'
  if (box) return 'Original Box Only'
  if (papers) return 'Original Papers Only'
  return 'None'
}

/**
 * appointment: where the meeting happens.
 *
 * Two outcomes, not the four Designer rows: row 4 duplicated row 2, and row 3
 * covered row 1. Anything that is not a home visit is in an office.
 */
export function computeMeetingVenue(root) {
  const type = get(root, 'appointment_type')
  if (!type) return null

  return type === 'Home visit or private office' ? 'Client location' : 'In-office'
}

/**
 * appointment: minutes to block out. Feeds appointment_end_datetime.
 *
 * The three Designer rows in document order, because the old mechanism took the
 * FIRST match and two rows could match at once:
 *
 *   sub_type = Drop off (15 minutes)             -> 15
 *   sub_type = Full consultation (30 to 60 minutes)  -> 60
 *   type     = Home visit or private office      -> 60
 *
 * A home visit booked as a drop-off matched rows 1 and 3, so it is 15.
 *
 * No default. An unrecognised sub_type matches no row and sends no key. A
 * default of 60 would book an hour after a Designer copy edit.
 */
export function computeAppointmentLength(root) {
  const subType = get(root, 'appointment_sub_type')
  if (subType === 'Drop off (15 minutes)') return '15'
  if (subType === 'Full consultation (30 to 60 minutes)') return '60'

  if (get(root, 'appointment_type') === 'Home visit or private office') return '60'

  return null
}

// Run order. appointment_length must be set before format-datetime reads it.
export const BUSINESS_RULES = [
  ['combined_asset_type', computeCombinedAssetType],
  ['box_and_papers', computeBoxAndPapers],
  ['meeting_venue', computeMeetingVenue],
  ['appointment_length', computeAppointmentLength],
  ['New_Lead_Type', computeNewLeadType],
]
