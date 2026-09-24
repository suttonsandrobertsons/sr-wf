import { beforeEach, describe, expect, it } from 'vitest'
import { formApp } from '../core/app.js'
import { formSteps } from '../core/navigation.js'

// Deep-linking to a later step (e.g. /get-a-quote?step=2) cannot skip step-1
// required fields. Redirect-mode forms land on step 2 with step-1 contact
// fields prefilled, so the guard only clamps when a prior step has unmet
// required fields.

function setUrl(search) {
  window.history.replaceState({}, '', `/get-a-quote${search}`)
}

function mountQuoteForm() {
  document.body.innerHTML = `
    <form data-form="get-a-quote">
      <div data-form-step>
        <div data-form-field="first_name" data-form-field-required="true">
          <input name="first_name" type="text">
        </div>
        <div data-form-field="email" data-form-field-required="true">
          <input name="email" type="email">
        </div>
        <button type="button" data-form-action="next">Next</button>
      </div>
      <div data-form-step>
        <div data-form-field="asset_type" data-form-field-required="true">
          <input name="asset_type" type="text">
        </div>
        <button type="submit">Submit</button>
      </div>
    </form>
  `
  formApp.boot(document)
  return formApp.getFormByRoot(document.querySelector('form'))
}

describe('deep-link step guard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    formApp.forms.clear()
    formApp.formKeys.clear()
    formApp.readyRoots = new WeakSet()
    window.sessionStorage.clear()
    setUrl('')
  })

  it('clamps ?step=2 back to step 1 when step-1 required fields are empty', () => {
    setUrl('?step=2')
    const form = mountQuoteForm()

    expect(form.stepIndex).toBe(0)
    expect(formSteps.getCurrentNumber(form)).toBe(1)
  })

  it('allows ?step=2 when step-1 required fields are prefilled (redirect deep-link)', () => {
    setUrl('?step=2&firstName=Dave&email=dave%40example.com')
    const form = mountQuoteForm()

    expect(form.root.querySelector('[name="first_name"]').value).toBe('Dave')
    expect(form.root.querySelector('[name="email"]').value).toBe('dave@example.com')
    expect(form.stepIndex).toBe(1)
    expect(formSteps.getCurrentNumber(form)).toBe(2)
  })
})
