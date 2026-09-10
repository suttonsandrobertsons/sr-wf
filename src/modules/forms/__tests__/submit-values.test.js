import { describe, expect, it } from 'vitest'
import { addMinutes, formatDate, formatTime, formSubmitValues } from '../submit-values/index.js'

describe('submit values', () => {
  it('formats date values as YYYY-MM-DD', () => {
    expect(formatDate('2026-07-02')).toBe('2026-07-02')
    expect(formatDate('02/07/2026')).toBe('')
    expect(formatDate('')).toBe('')
  })

  it('rejects dates with out-of-range month or day', () => {
    expect(formatDate('2026-99-99')).toBe('')
    expect(formatDate('2026-13-01')).toBe('')
    expect(formatDate('2026-02-30')).toBe('')
    expect(formatDate('2026-00-10')).toBe('')
    expect(formatDate('2024-02-29')).toBe('2024-02-29')
  })

  it('formats time values as HH:mm:ss', () => {
    expect(formatTime('9:30')).toBe('09:30:00')
    expect(formatTime('10:30:15')).toBe('10:30:15')
    expect(formatTime('25:30')).toBe('')
  })

  it('adds a hidden formatted field from wrapper data-form-field', () => {
    document.body.innerHTML = `
      <form data-form="test">
        <div data-form-field="random" data-form-field-type="date">
          <input name="some_date_input" value="2026-07-02">
        </div>
      </form>
    `

    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="random_formatted"]').value).toBe('2026-07-02')
  })

  it('adds a hidden formatted field from direct data-form-field', () => {
    document.body.innerHTML = `
      <form data-form="test">
        <input name="appointment_time" value="9:30" data-form-field="appointment_time" data-form-field-type="time">
      </form>
    `

    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="appointment_time_formatted"]').value).toBe('09:30:00')
  })

  it('falls back to the input name when data-form-field is missing', () => {
    document.body.innerHTML = `
      <form data-form="test">
        <input name="appointment_date" value="2026-07-02" data-form-field-type="date">
      </form>
    `

    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="appointment_date_formatted"]').value).toBe('2026-07-02')
  })

  it('clears stale formatted values when source value is invalid', () => {
    document.body.innerHTML = `
      <form data-form="test">
        <input type="hidden" name="appointment_time_formatted" value="stale">
        <input name="appointment_time" value="25:30" data-form-field-type="time">
      </form>
    `

    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="appointment_time_formatted"]').value).toBe('')
  })

  it('ignores untyped date and time fields', () => {
    document.body.innerHTML = `
      <form data-form="test">
        <input name="appointment_date" value="2026-07-02">
      </form>
    `

    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="appointment_date_formatted"]')).toBeNull()
  })

  it('combines the Other sub-type into combined_asset_type', () => {
    document.body.innerHTML = `
      <form data-form="test">
        <input name="asset_type" value="Other">
        <input name="other_asset_types" value="Diamond Jewellery">
      </form>
    `

    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="combined_asset_type"]').value).toBe('Diamond Jewellery')
  })

  it('uses the main category and ignores a stale sub-type when not Other', () => {
    document.body.innerHTML = `
      <form data-form="test">
        <input name="asset_type" value="Watches">
        <input name="other_asset_types" value="Diamond Jewellery">
      </form>
    `

    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="combined_asset_type"]').value).toBe('Watches')
  })

  it('does not write combined_asset_type when no asset is selected', () => {
    document.body.innerHTML = `
      <form data-form="test">
        <input name="email" value="a@b.com">
      </form>
    `

    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="combined_asset_type"]')).toBeNull()
  })

  // New_Lead_Type: enquiry_type + the two sell-only follow-ups, comma-joined for
  // Zoho's multi-select. Replaces the four same-named hidden inputs that the
  // single-submit dedup could only ever let one of through.
  const leadTypeForm = ({ enquiry, loan, consignment, hiddenFollowUps = false }) => {
    const state = hiddenFollowUps ? 'data-form-state="condition-hidden"' : ''
    // Render each follow-up's options in the SAME casing as the answer under
    // test, so a lowercase answer exercises lowercase markup (as the site's
    // other Yes/No radios use) rather than silently matching nothing.
    const radios = (name, answer) => {
      if (!answer) return ''
      const lower = answer === answer.toLowerCase()
      return ['Yes', 'No']
        .map((option) => {
          const value = lower ? option.toLowerCase() : option
          const checked = value === answer ? 'checked' : ''
          return `<label><input type="radio" name="${name}" value="${value}" ${checked} ${state}>${option}</label>`
        })
        .join('')
    }
    document.body.innerHTML = `
      <form data-form="quote">
        <input type="hidden" name="enquiry_type" value="${enquiry}">
        <div data-form-show-if="enquiry_type=Sell My Items" ${state}>
          ${radios('enquiry_consider_loan', loan)}
          ${radios('enquiry_consider_consignment', consignment)}
        </div>
      </form>
    `
    const root = document.querySelector('form')
    formSubmitValues.apply(root)
    return root.querySelector('[name="New_Lead_Type"]')
  }

  it('sends Loan Customer for a loan enquiry (no follow-ups asked)', () => {
    expect(leadTypeForm({ enquiry: 'Loan' }).value).toBe('Loan Customer')
  })

  it('accumulates every lead type when a sell lead says Yes to both follow-ups', () => {
    expect(leadTypeForm({ enquiry: 'Sell My Items', loan: 'Yes', consignment: 'Yes' }).value)
      .toBe('SHP Customer, Loan Customer, Consignment Customer')
  })

  it('adds Loan Customer for a sell lead open to a loan only', () => {
    expect(leadTypeForm({ enquiry: 'Sell My Items', loan: 'Yes', consignment: 'No' }).value)
      .toBe('SHP Customer, Loan Customer')
  })

  it('adds Consignment Customer for a sell lead open to consignment only', () => {
    expect(leadTypeForm({ enquiry: 'Sell My Items', loan: 'No', consignment: 'Yes' }).value)
      .toBe('SHP Customer, Consignment Customer')
  })

  // The case that would submit an empty field without the SHP base value.
  it('still sends SHP Customer when a sell lead declines both follow-ups', () => {
    expect(leadTypeForm({ enquiry: 'Sell My Items', loan: 'No', consignment: 'No' }).value)
      .toBe('SHP Customer')
  })

  // The site's other Yes/No radios use lowercase values, so both casings must work.
  it('accepts lowercase yes/no follow-up values', () => {
    expect(leadTypeForm({ enquiry: 'Sell My Items', loan: 'yes', consignment: 'no' }).value)
      .toBe('SHP Customer, Loan Customer')
  })

  // The gold calculator asks no follow-ups at all — the base value has to carry it.
  it('sends SHP Customer for a sell lead on a form with no follow-up questions', () => {
    document.body.innerHTML = `
      <form data-form="gold">
        <input type="hidden" name="enquiry_type" value="Sell My Items">
      </form>
    `
    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="New_Lead_Type"]').value).toBe('SHP Customer')
  })

  // A Loan enquiry must never inherit answers the visitor gave before switching.
  it('ignores condition-hidden follow-up answers', () => {
    expect(leadTypeForm({
      enquiry: 'Loan', loan: 'Yes', consignment: 'Yes', hiddenFollowUps: true,
    }).value).toBe('Loan Customer')
  })

  it('writes an empty value for an enquiry type it does not recognise', () => {
    expect(leadTypeForm({ enquiry: 'Consignment' }).value).toBe('')
  })

  it('does not write New_Lead_Type when no enquiry type is present', () => {
    document.body.innerHTML = `
      <form data-form="footer-form">
        <input name="email" value="a@b.com">
      </form>
    `
    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="New_Lead_Type"]')).toBeNull()
  })

  // Belt-and-braces: if a stale Designer hidden input survives on some page, the
  // derived value must overwrite it rather than add a second same-named input.
  it('overwrites a leftover hidden New_Lead_Type input instead of duplicating it', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <input type="hidden" name="enquiry_type" value="Loan">
        <input type="hidden" name="New_Lead_Type" value="Loan Customer, SHP Customer, Consignment Customer">
      </form>
    `
    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    const fields = root.querySelectorAll('[name="New_Lead_Type"]')
    expect(fields).toHaveLength(1)
    expect(fields[0].value).toBe('Loan Customer')
  })

  it('addMinutes adds a duration and returns YYYY-MM-DDTHH:mm:ss', () => {
    expect(addMinutes('2026-07-09', '14:00:00', 60)).toBe('2026-07-09T15:00:00')
    expect(addMinutes('2026-07-09', '14:00:00', 15)).toBe('2026-07-09T14:15:00')
  })

  it('addMinutes rolls over to the next day (and month) correctly', () => {
    expect(addMinutes('2026-07-09', '23:30:00', 60)).toBe('2026-07-10T00:30:00')
    expect(addMinutes('2026-07-31', '23:45:00', 30)).toBe('2026-08-01T00:15:00')
  })

  it('computes appointment start + end datetimes from date, time and length', () => {
    document.body.innerHTML = `
      <form data-form="appointment">
        <input name="appointment_date" value="2026-07-09">
        <input name="appointment_time" value="14:00">
        <input type="radio" name="appointment_sub_type" value="Full consultation (30 to 60 minutes)" checked>
      </form>
    `

    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="appointment_start_datetime"]').value).toBe('2026-07-09T14:00:00')
    expect(root.querySelector('[name="appointment_end_datetime"]').value).toBe('2026-07-09T15:00:00')
  })

  it('uses the 15-minute drop-off length', () => {
    document.body.innerHTML = `
      <form data-form="appointment">
        <input name="appointment_date" value="2026-07-09">
        <input name="appointment_time" value="9:30">
        <input type="radio" name="appointment_sub_type" value="Drop off (15 minutes)" checked>
      </form>
    `

    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="appointment_start_datetime"]').value).toBe('2026-07-09T09:30:00')
    expect(root.querySelector('[name="appointment_end_datetime"]').value).toBe('2026-07-09T09:45:00')
  })

  it('emits empty appointment datetimes when date/time are absent (home visit)', () => {
    document.body.innerHTML = `
      <form data-form="appointment">
        <input name="appointment_length" value="60">
      </form>
    `

    const root = document.querySelector('form')
    formSubmitValues.apply(root)

    expect(root.querySelector('[name="appointment_start_datetime"]').value).toBe('')
    expect(root.querySelector('[name="appointment_end_datetime"]').value).toBe('')
  })
})
