import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formApp, formAttribution, formChoices, formDom, formFields, formEvents } from '../core.js'

function bootForm(root) {
  const form = { root, steps: [], scope: root, syncedFieldKeys: new Set() }
  formChoices.configure(form)
  formApp.refresh(form)
  return form
}

function submitEvent() {
  return new Event('submit', { bubbles: true, cancelable: true })
}

describe('validation skips CSS-hidden fields (Fix #4)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('does NOT block submit on a display:none required field (hidden on the field itself)', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-field><input name="visible" data-form-field-required="true" value="filled"></div>
        <div data-form-field style="display:none"><input name="hidden_field" data-form-field-required="true" value=""></div>
      </form>
    `
    const form = bootForm(document.querySelector('form'))
    expect(formFields.validateScope(form, form.root)).toBe(true)
  })

  it('does NOT block submit when a required field is hidden by an ANCESTOR display:none', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-field><input name="visible" data-form-field-required="true" value="filled"></div>
        <div style="display:none">
          <div data-form-field><input name="hidden_field" data-form-field-required="true" value=""></div>
        </div>
      </form>
    `
    const form = bootForm(document.querySelector('form'))
    expect(formFields.validateScope(form, form.root)).toBe(true)
  })

  it('still blocks submit when a genuinely visible required field is empty', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-field><input name="visible" data-form-field-required="true" value=""></div>
      </form>
    `
    const form = bootForm(document.querySelector('form'))
    expect(formFields.validateScope(form, form.root)).toBe(false)
  })

  it('isVisuallyHidden treats a visibility:hidden field as hidden but a plain field as visible', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <input id="plain" name="a">
        <input id="invisible" name="b" style="visibility:hidden">
      </form>
    `
    expect(formDom.isVisuallyHidden(document.getElementById('plain'))).toBe(false)
    expect(formDom.isVisuallyHidden(document.getElementById('invisible'))).toBe(true)
  })
})

describe('handleSubmit robustness (Fix #1 + #3)', () => {
  beforeEach(() => {
    document.body.innerHTML = `<form data-form="quote"></form>`
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('resets isSubmitting when the success-path work throws (no wedge)', () => {
    const form = bootForm(document.querySelector('form'))
    const spy = vi.spyOn(formAttribution, 'pushDataLayer').mockImplementation(() => {
      throw new Error('boom in GTM push')
    })

    expect(() => formEvents.handleSubmit(form, submitEvent())).not.toThrow()

    expect(spy).toHaveBeenCalled()
    expect(form.isSubmitting).toBe(false)
  })

  it('submit-timeout fallback clears isSubmitting after the window with no observer', () => {
    vi.useFakeTimers()
    const form = bootForm(document.querySelector('form'))

    formEvents.handleSubmit(form, submitEvent())
    // Native handoff armed the fallback timer; form is mid-submit.
    expect(form.isSubmitting).toBe(true)

    vi.advanceTimersByTime(30000)

    expect(form.isSubmitting).toBe(false)
    expect(form.submitTimeoutId).toBe(null)
  })

  it('a Webflow success clears the timeout so the fallback does not double-fire', () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <div class="w-form">
        <form data-form="quote"></form>
        <div class="w-form-done" style="display:none"></div>
        <div class="w-form-fail" style="display:none"></div>
      </div>
    `
    const form = bootForm(document.querySelector('form'))
    form.scope = document.querySelector('.w-form')
    formEvents.watchSuccess(form)
    formEvents.watchFailure(form)

    formEvents.handleSubmit(form, submitEvent())
    expect(form.isSubmitting).toBe(true)

    // Success arrives before the timeout window.
    formEvents.onWebflowSuccess(form)
    expect(form.isSubmitting).toBe(false)
    expect(form.submitTimeoutId).toBe(null)

    // Advancing past the window must not re-run the fallback (no throw, stays reset).
    vi.advanceTimersByTime(30000)
    expect(form.isSubmitting).toBe(false)
  })
})
