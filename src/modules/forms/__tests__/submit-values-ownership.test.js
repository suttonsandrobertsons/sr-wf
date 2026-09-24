// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { formSubmitValues } from '../submit-values/index.js'
import { submittedFields } from './helpers/webflow-submit.js'

// A rule that declines to answer must still rename a same-named Designer
// input, or Webflow keeps the last duplicate and Zoho gets a wrong value
// instead of none.
//
// Those Designer inputs are no longer on the pages. These tests stay because
// the renaming is what makes re-adding one harmless.
describe('submit-values owns its field names', () => {
  const boot = (html) => {
    document.body.innerHTML = `<form data-form="quote">${html}</form>`
    return document.querySelector('form')
  }

  const LEGACY_BOX = `
    <input type="hidden" name="box_and_papers" value="Original Box and Papers" data-form-show-if="original_box=yes; original_paperwork=yes">
    <input type="hidden" name="box_and_papers" value="Original Box Only" data-form-show-if="original_box=yes; original_paperwork=no">
    <input type="hidden" name="box_and_papers" value="Original Papers Only" data-form-show-if="original_box=no; original_paperwork=yes">
    <input type="hidden" name="box_and_papers" value="None" data-form-show-if="original_box=no; original_paperwork=no">`

  it('sends no key when the questions are not asked, despite same-named inputs', () => {
    // get-a-quote asks box/papers for some asset types only. Other leads send
    // no box_and_papers key, rather than "None".
    const root = boot(LEGACY_BOX)
    formSubmitValues.apply(root)

    expect(submittedFields(root).box_and_papers).toBeUndefined()
    expect(submittedFields(root)._disabled_box_and_papers).toBe('None')
  })

  it('sends the computed value when the questions are answered', () => {
    const root = boot(`
      <input type="radio" name="original_box" value="yes" checked>
      <input type="radio" name="original_paperwork" value="no" checked>
      ${LEGACY_BOX}`)
    formSubmitValues.apply(root)

    expect(submittedFields(root).box_and_papers).toBe('Original Box Only')
  })

  it('drops a value it wrote earlier once the answer goes away', () => {
    const root = boot(`
      <input type="radio" name="original_box" value="yes" checked>
      <input type="radio" name="original_paperwork" value="yes" checked>`)
    formSubmitValues.apply(root)
    expect(submittedFields(root).box_and_papers).toBe('Original Box and Papers')

    // Customer changes asset type; the questions are removed from the DOM.
    root.querySelectorAll('[name^="original_"]').forEach((el) => el.remove())
    formSubmitValues.apply(root)

    expect(submittedFields(root).box_and_papers).toBeUndefined()
  })

  it('is idempotent across repeated applies', () => {
    const root = boot(`
      <input type="radio" name="original_box" value="no" checked>
      <input type="radio" name="original_paperwork" value="no" checked>
      ${LEGACY_BOX}`)
    formSubmitValues.apply(root)
    formSubmitValues.apply(root)
    formSubmitValues.apply(root)

    expect(root.querySelectorAll('[name="box_and_papers"]')).toHaveLength(1)
    expect(submittedFields(root).box_and_papers).toBe('None')
  })

  it('never renames its own hidden, however many times apply runs', () => {
    // New_Lead_Type is kept out of chooseOneFieldNames so a render pass cannot
    // rename the rule's own hidden input; data-form-owned-value marks it too.
    // No render pass runs here: this only proves apply() is idempotent.
    const root = boot(`<input type="radio" name="enquiry_type" value="Consignment" checked>`)
    formSubmitValues.apply(root)
    formSubmitValues.apply(root)
    formSubmitValues.apply(root)

    const payload = submittedFields(root)
    expect(payload.New_Lead_Type).toBe('')
    expect(payload._disabled_New_Lead_Type).toBeUndefined()
    expect(root.querySelectorAll('[name="New_Lead_Type"]')).toHaveLength(1)
  })

  it('keeps a home-visit drop-off at 15, as the Designer rows did', () => {
    // Pins first-match row order, not a customer path: appointment_sub_type
    // is condition-hidden for a home visit, so a real home visit resolves to
    // 60 either way. Checking home visit first would change the two reachable
    // rows.
    const root = boot(`
      <input type="radio" name="appointment_type" value="Home visit or private office" checked>
      <input type="radio" name="appointment_sub_type" value="Drop off (15 minutes)" checked>`)
    formSubmitValues.apply(root)

    expect(submittedFields(root).appointment_length).toBe('15')
  })

  it('sends no length for a sub-type no row matches', () => {
    // A default of 60 would turn a Designer copy edit into an hour booking.
    const root = boot(`<input type="radio" name="appointment_sub_type" value="Drop off (15 mins)" checked>`)
    formSubmitValues.apply(root)

    expect(submittedFields(root).appointment_length).toBeUndefined()
  })
})
