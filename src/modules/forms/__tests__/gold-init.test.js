import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initGoldForms } from '../gold.js'

// A gold form needs at least one CMS pricing row or createInstance() throws.
// A form whose setup throws (e.g. pricing rows arrive late) is retried on a
// later initGoldForms() pass, not marked initialised for good.

function buildForm() {
  document.body.innerHTML = `
    <form data-form-gold data-form-state="">
      <div data-form-gold-pricing></div>
    </form>
  `
  return document.querySelector('form[data-form-gold]')
}

function addPricingRow(form) {
  const container = form.querySelector('[data-form-gold-pricing]')
  container.innerHTML = `
    <div data-form-gold-pricing-row>
      <span data-form-gold-pricing-field="assetType">gold</span>
      <span data-form-gold-pricing-field="itemType">jewellery</span>
      <span data-form-gold-pricing-field="label">9ct Gold</span>
      <span data-form-gold-pricing-field="weightGrams">1</span>
      <span data-form-gold-pricing-field="purityCarats">9</span>
    </div>
  `
}

describe('gold init latch', () => {
  beforeEach(() => {
    // A pending spot-price request avoids network errors; a fetch call shows
    // createInstance() ran (it does not run for a latched form).
    global.fetch = vi.fn(() => new Promise(() => {}))
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('retries a form whose first init failed once pricing rows arrive', () => {
    const form = buildForm()

    // First pass: no pricing rows -> createInstance throws -> form marked error.
    initGoldForms(document)
    expect(form.getAttribute('data-form-state')).toContain('error')
    expect(global.fetch).not.toHaveBeenCalled()

    // Rows injected late; a second pass must re-run createInstance (not latched).
    addPricingRow(form)
    initGoldForms(document)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not re-init a form that already initialised successfully', () => {
    const form = buildForm()
    addPricingRow(form)

    initGoldForms(document)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // Second pass must be a no-op: the form is genuinely initialised.
    initGoldForms(document)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
