import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formApp, formAttribution, formChoices, formDom, formEvents, formFields, formSteps, formSuccessPage, formUploads } from '../core.js'
import { initLoanForms } from '../loan.js'
import { submittedEntries } from "./helpers/webflow-submit.js"
import { formSubmitValues } from '../submit-values/index.js'

function bootForm(root) {
  const form = { root, steps: [], scope: root, syncedFieldKeys: new Set() }
  formChoices.configure(form)
  formApp.refresh(form)
  return form
}

function formPayload(form) {
  return submittedEntries(form.root)
}

describe('form UI regressions', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    formSuccessPage.hasScrolled = false
    window.sessionStorage.clear()
  })

  it('clears invalid state from all radios in a group when one changes', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-choice-group data-form-field-required="true">
          <label data-form-choice>
            <input type="radio" name="contact_method" value="Email">
            Email
          </label>
          <label data-form-choice>
            <input type="radio" name="contact_method" value="Phone">
            Phone
          </label>
          <div data-form-error></div>
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    const radios = Array.from(form.root.querySelectorAll('[name="contact_method"]'))
    const choices = Array.from(form.root.querySelectorAll('[data-form-choice]'))

    choices.forEach((choice, index) => {
      formDom.setState(choice, 'invalid', true)
      radios[index].setAttribute('aria-invalid', 'true')
    })

    const phoneRadio = radios[1]
    phoneRadio.checked = true
    formChoices.clearNamedChoiceError(form.root, phoneRadio)

    choices.forEach((choice) => {
      expect(choice.getAttribute('data-form-state') || '').not.toContain('invalid')
    })
    radios.forEach((radio) => {
      expect(radio.hasAttribute('aria-invalid')).toBe(false)
    })
  })

  it('clears invalid state from all checkboxes in a group when one changes', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-choice-group data-form-field-required="true">
          <label data-form-choice>
            <input type="checkbox" name="contact_method" value="Email">
            Email
          </label>
          <label data-form-choice>
            <input type="checkbox" name="contact_method" value="Phone">
            Phone
          </label>
          <div data-form-error></div>
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    const checkboxes = Array.from(form.root.querySelectorAll('[data-form-name="contact_method"]'))
    const choices = Array.from(form.root.querySelectorAll('[data-form-choice]'))

    choices.forEach((choice, index) => {
      formDom.setState(choice, 'invalid', true)
      checkboxes[index].setAttribute('aria-invalid', 'true')
    })

    checkboxes[1].checked = true
    formChoices.clearNamedChoiceError(form.root, checkboxes[1])

    choices.forEach((choice) => {
      expect(choice.getAttribute('data-form-state') || '').not.toContain('invalid')
    })
    checkboxes.forEach((checkbox) => {
      expect(checkbox.hasAttribute('aria-invalid')).toBe(false)
    })
  })

  it('lets links inside checkbox choice cards open normally', () => {
    document.body.innerHTML = `
      <div data-form-choice>
        <input type="checkbox" name="privacy_opt_in" value="yes">
        <a href="#privacy-policy">Privacy Policy</a>
      </div>
    `

    const choice = document.querySelector('[data-form-choice]')
    const input = choice.querySelector('input')
    const link = choice.querySelector('a')
    choice.addEventListener('click', (event) => formChoices.handleClick(event, choice))

    const linkClick = link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(linkClick).toBe(true)
    expect(input.checked).toBe(false)

    const cardClick = choice.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(cardClick).toBe(false)
    expect(input.checked).toBe(true)
  })

  it('refreshes custom checkbox UI when the overlaid native input changes', async () => {
    document.body.innerHTML = `
      <form data-form="courier">
        <label data-form-choice>
          <span>Terms & conditions</span>
          <input class="form_check-clickable" type="checkbox" name="privacy_opt_in" value="privacy_opt_in">
        </label>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    const choice = form.root.querySelector('[data-form-choice]')
    const input = form.root.querySelector('input')

    formEvents.bind(form)
    input.checked = true
    input.dispatchEvent(new Event('change', { bubbles: true }))

    expect(choice.getAttribute('aria-checked')).toBe('true')
    expect(choice.getAttribute('data-form-state')).toContain('selected')
  })

  it('exposes dev helpers before the first submit', async () => {
    await import('../dev.js')
    expect(typeof window.sr?.dev?.scanFields).toBe('function')
    expect(typeof window.sr?.dev?.scanAll).toBe('function')
  })

  it('submits named consent choices without hidden mirrors', async () => {
    document.body.innerHTML = `
      <form data-form="gold">
        <label data-form-choice data-form-field-required="true">
          <input type="checkbox" name="privacy_opt_in" value="privacy_opt_in" checked>
          Privacy
        </label>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    const input = form.root.querySelector('[data-form-name="privacy_opt_in"]')
    const hidden = form.root.querySelector('input[type="hidden"][data-form-name="privacy_opt_in"]')

    expect(input.disabled).toBe(false)
    expect(input.name).toBe('privacy_opt_in')
    expect(hidden).toBeNull()
    // A checkbox never submits its value — Webflow submits the boolean.
    expect(Object.fromEntries(formPayload(form))).toEqual({ privacy_opt_in: true })

    await import('../dev.js')
    form.root.dispatchEvent(new CustomEvent('suttons:form-submit', {
      detail: { form },
      bubbles: true,
    }))

    expect(form._devSubmissionData.data.privacy_opt_in).toBe('privacy_opt_in')

    input.checked = false
    formApp.refresh(form)
    // Unchecking does not remove the key: Webflow submits every control, and an
    // unchecked checkbox arrives as the boolean false.
    expect(Object.fromEntries(formPayload(form))).toEqual({ privacy_opt_in: false })
  })

  it('preserves checkbox names and materializes same-name groups at submit', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-choice-group data-form-field="contact_method">
          <label data-form-choice>
            <input type="checkbox" name="contact_method" value="Email" checked>
            Email
          </label>
          <label data-form-choice>
            <input type="checkbox" name="contact_method" value="WhatsApp">
            WhatsApp
          </label>
          <label data-form-choice>
            <input type="checkbox" name="contact_method" value="Phone" checked>
            Phone
          </label>
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    const checkboxes = Array.from(form.root.querySelectorAll('input[type="checkbox"][data-form-name="contact_method"]'))
    const hidden = form.root.querySelector('input[type="hidden"][data-form-name="contact_method"]')

    expect(checkboxes.every((checkbox) => !checkbox.disabled)).toBe(true)
    expect(checkboxes.every((checkbox) => checkbox.name === 'contact_method')).toBe(true)
    expect(hidden.disabled).toBe(true)
    // Duplicate names collapse to the LAST control in DOM order, and the
    // aggregate hidden is appended after the checkboxes — so it already wins
    // here, before prepareControlsForSubmit disables anything.
    expect(Object.fromEntries(formPayload(form))).toEqual({ contact_method: 'Email,Phone' })

    formFields.prepareControlsForSubmit(form)

    expect(hidden.disabled).toBe(false)
    expect(checkboxes.every((checkbox) => checkbox.disabled)).toBe(true)
    expect(Object.fromEntries(formPayload(form))).toEqual({ contact_method: 'Email,Phone' })

    formApp.refresh(form)
    checkboxes[2].checked = false
    formApp.refresh(form)
    formFields.prepareControlsForSubmit(form)

    expect(formPayload(form)).toEqual([
      ['contact_method', 'Email'],
    ])

    formApp.refresh(form)
    checkboxes.forEach((checkbox) => {
      checkbox.checked = false
    })
    formApp.refresh(form)
    formFields.prepareControlsForSubmit(form)

    expect(hidden.disabled).toBe(true)
    expect(hidden.value).toBe('')
  })

  it('materializes checkbox group lists alongside individual checkbox fields', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-choice-group data-form-field="contact_method">
          <label data-form-choice>
            <input type="checkbox" name="contact_method_email" value="Email" checked>
            Email
          </label>
          <label data-form-choice>
            <input type="checkbox" name="contact_method_whatsapp" value="WhatsApp">
            WhatsApp
          </label>
          <label data-form-choice>
            <input type="checkbox" name="contact_method_phone" value="Phone" checked>
            Phone
          </label>
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))

    expect(Object.fromEntries(formPayload(form))).toEqual({
      // Unchecked boxes are submitted too, as the boolean false.
      contact_method_email: true,
      contact_method_whatsapp: false,
      contact_method_phone: true,
      contact_method: 'Email,Phone',
    })

    const whatsapp = form.root.querySelector('[data-form-name="contact_method_whatsapp"]')
    whatsapp.checked = true
    formApp.refresh(form)

    expect(Object.fromEntries(formPayload(form))).toEqual({
      contact_method_email: true,
      contact_method_whatsapp: true,
      contact_method_phone: true,
      contact_method: 'Email,WhatsApp,Phone',
    })
  })

  it('uses checkbox group selections for conditions before hidden submit fields sync', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-choice-group data-form-field="contact_method">
          <label data-form-choice>
            <input type="checkbox" name="contact_method_email" value="Email">
            Email
          </label>
          <label data-form-choice>
            <input type="checkbox" name="contact_method_phone" value="Phone" checked>
            Phone
          </label>
        </div>
        <div data-form-show-if="contact_method=Phone">
          <input name="phone_follow_up" value="call-me">
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    const followUp = form.root.querySelector('[data-form-show-if]')

    expect(followUp.getAttribute('data-form-state') || '').not.toContain('condition-hidden')
    expect(formPayload(form)).toContainEqual(['contact_method', 'Phone'])
  })

  // Uses bullion_name because it is the only field still on the choose-one
  // path. box_and_papers moved to submit-values/business-rules.js on 9 Sep 2026.
  it('keeps only active branch values in the submit payload', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <input type="hidden" name="bullion_name" value="Gold Sovereign">
        <div data-form-show-if="item_type=bar" data-form-state="condition-hidden">
          <input type="hidden" name="bullion_name" value="None" data-form-state="condition-hidden">
        </div>
        <label>
          <input type="checkbox" name="contact_method" value="Email" checked>
          Email
        </label>
        <label>
          <input type="checkbox" name="contact_method" value="Phone" checked>
          Phone
        </label>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    const hiddenFallback = form.root.querySelector('[value="None"]')

    expect(formDom.isConditionHidden(hiddenFallback)).toBe(true)
    expect(hiddenFallback.disabled).toBe(false)
    formFields.prepareControlsForSubmit(form)
    expect(hiddenFallback.disabled).toBe(false)
    expect(hiddenFallback.name).toBe('_disabled_bullion_name')
    expect(Object.fromEntries(formPayload(form))).toEqual({
      bullion_name: 'Gold Sovereign',
      _disabled_bullion_name: 'None',
      contact_method: 'Email,Phone',
    })
  })

  it('renames EVERY control of a choose-one group when they are on a step the customer has left', () => {
    // The trap, recorded so it is not proposed as a fix a second time.
    //
    // prepareChooseOneControls picks the active control with
    // !isStepHidden(control) (core/fields.js). On a multi-step form the
    // customer submits from the LAST step, so a group living on an earlier step
    // has no active member and every one of them is renamed _disabled_*.
    //
    // This is why data-form-submit-single must NOT be used to fix the
    // get-a-quote brand fields: they sit on step 2 and submit happens on step
    // 4, so Brand would arrive EMPTY on every lead rather than merely wrong.
    // Use the [data-form-field-group] aggregate instead, which reads only
    // non-hidden controls and is already in the payload as `brands`.
    document.body.innerHTML = `
      <form data-form="multi">
        <div data-form-step>
          <div data-form-field="watch_brand">
            <select name="watch_brand" data-form-submit-single="brand">
              <option value="Rolex" selected>Rolex</option>
            </select>
          </div>
          <div data-form-field="jewellery_brand">
            <select name="jewellery_brand" data-form-submit-single="brand">
              <option value="Cartier" selected>Cartier</option>
            </select>
          </div>
        </div>
        <div data-form-step>
          <input name="email" value="dev@dev.com">
        </div>
      </form>
    `
    const root = document.querySelector('form')
    const form = bootForm(root)
    form.steps = Array.from(root.querySelectorAll('[data-form-step]'))
    formSteps.configure?.(form)

    const onStep = (index) => {
      form.steps.forEach((step, i) => formDom.setState(step, 'step-hidden', i !== index))
      formFields.prepareControlsForSubmit(form)
      return Object.fromEntries(formPayload(form))
    }

    // While the customer is ON step 1 the mechanism works as advertised: the
    // first readable control wins and keeps its name. This half is asserted so
    // the test below cannot pass just because nothing was grouped at all.
    const onBrandStep = onStep(0)
    expect(onBrandStep.watch_brand).toBe('Rolex')
    expect(onBrandStep._disabled_jewellery_brand).toBe('Cartier')

    // At submit the customer is on the last step, and now NOTHING wins.
    const atSubmit = onStep(form.steps.length - 1)
    expect(atSubmit.watch_brand).toBeUndefined()
    expect(atSubmit.jewellery_brand).toBeUndefined()
    expect(atSubmit._disabled_watch_brand).toBe('Rolex')
    expect(atSubmit._disabled_jewellery_brand).toBe('Cartier')
  })

  // Was a choose-one test over four same-named hidden inputs. box_and_papers is
  // now a business rule, so this asserts the rule wins even when a same-named
  // Designer input is present. Those inputs were deleted on 10 Sep 2026; this
  // keeps the guarantee that re-adding one cannot beat the rule.
  //
  // Radios because that is what the live forms use. (formValues.get reads
  // type="hidden" too — an earlier version of this comment claimed otherwise.)
  it('computes box_and_papers and overrides the legacy Designer inputs', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <input type="radio" name="original_box" value="yes" checked>
        <input type="radio" name="original_paperwork" value="yes" checked>
        <input type="hidden" name="box_and_papers" value="Original Box and Papers" data-form-field="box_and_papers" data-form-show-if="original_box=yes; original_paperwork=yes">
        <input type="hidden" name="box_and_papers" value="None" data-form-field="box_and_papers" data-form-show-if="original_box=no; original_paperwork=no">
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    // Business rules run at SUBMIT, not on render — events.js calls
    // formSubmitValues.apply() there. The old choose-one dedup ran on both,
    // which is why this test used to need no explicit call.
    formSubmitValues.apply(form.root)
    const payload = Object.fromEntries(formPayload(form))

    expect(payload.box_and_papers).toBe('Original Box and Papers')
    // The leftovers are renamed out of the way, exactly as before.
    expect(payload._disabled_box_and_papers).toBeDefined()
  })

  it('supports form-level configured single-submit field names', () => {
    document.body.innerHTML = `
      <form data-form="quote" data-form-submit-single-names="Lead_Category">
        <input type="hidden" name="enquiry_type" value="Sell My Items">
        <input type="hidden" name="Lead_Category" value="Loan" data-form-show-if="enquiry_type=Loan">
        <input type="hidden" name="Lead_Category" value="Sale" data-form-show-if="enquiry_type=Sell My Items">
      </form>
    `

    const form = bootForm(document.querySelector('form'))

    expect(formPayload(form)).toEqual([
      ['enquiry_type', 'Sell My Items'],
      ['_disabled_Lead_Category', 'Loan'],
      ['Lead_Category', 'Sale'],
    ])
  })

  it('submits active input type="hidden" fields', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <input type="hidden" name="lead_reference" value="REF-123">
        <input type="hidden" name="utm_source" value="google">
      </form>
    `

    const form = bootForm(document.querySelector('form'))

    expect(formPayload(form)).toEqual([
      ['lead_reference', 'REF-123'],
      ['utm_source', 'google'],
    ])
  })

  it('submits money fields as clean numeric values', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-field="requested_amount" data-form-field-type="money">
          <input name="requested_amount" value="£5,000">
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    formFields.normalizeBeforeSubmit(form)

    expect(formPayload(form)).toEqual([
      ['requested_amount', '5000'],
    ])
  })

  it('keeps money fields formatted with separators on blur/change', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-field="requested_amount" data-form-field-type="money">
          <input name="requested_amount" value="10000">
        </div>
      </form>
    `

    const field = document.querySelector('input[name="requested_amount"]')
    formFields.normalizeField(field)

    // Comma persists for display after clicking out of the field...
    expect(field.value).toBe('10,000')

    // ...but the submitted payload is still a clean number.
    const form = bootForm(document.querySelector('form'))
    formFields.normalizeBeforeSubmit(form)
    expect(formPayload(form)).toEqual([
      ['requested_amount', '10000'],
    ])
  })

  it('submits only the active unique brand field before Zapier normalization', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-field="watch_brand">
          <select name="watch_brand">
            <option value="">Select brand</option>
            <option value="Rolex" selected>Rolex</option>
          </select>
        </div>
        <div data-form-field="jewellery_brand" data-form-state="condition-hidden hidden">
          <select name="jewellery_brand">
            <option value="">Select brand</option>
            <option value="Cartier">Cartier</option>
          </select>
        </div>
        <div data-form-field="handbag_brand" data-form-state="condition-hidden hidden">
          <select name="handbag_brand">
            <option value="">Select brand</option>
            <option value="Gucci">Gucci</option>
          </select>
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    formFields.prepareControlsForSubmit(form)

    expect(Object.fromEntries(formPayload(form))).toEqual({
      watch_brand: 'Rolex',
      // The inactive branches are condition-hidden and disabled, which does not
      // stop Webflow submitting them — they arrive empty rather than absent.
      jewellery_brand: '',
      handbag_brand: '',
    })
  })

  it('materializes a brand group list alongside individual brand selects', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-field-group data-form-field="brands">
          <div data-form-field="watch_brand">
            <select name="watch_brand">
              <option value="">Select brand</option>
              <option value="Rolex" selected>Rolex</option>
            </select>
          </div>
          <div data-form-field="jewellery_brand" data-form-state="condition-hidden hidden">
            <select name="jewellery_brand">
              <option value="">Select brand</option>
              <option value="Cartier">Cartier</option>
            </select>
          </div>
          <div data-form-field="handbag_brand" data-form-state="condition-hidden hidden">
            <select name="handbag_brand">
              <option value="">Select brand</option>
              <option value="Gucci">Gucci</option>
            </select>
          </div>
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    formFields.prepareControlsForSubmit(form)

    expect(Object.fromEntries(formPayload(form))).toEqual({
      watch_brand: 'Rolex',
      jewellery_brand: '',
      handbag_brand: '',
      brands: 'Rolex',
    })
  })

  it('formats multi-value field groups as comma-separated text for Zapier', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-field-group data-form-field="brands">
          <div data-form-field="watch_brand">
            <select name="watch_brand">
              <option value="">Select brand</option>
              <option value="Rolex" selected>Rolex</option>
            </select>
          </div>
          <div data-form-field="jewellery_brand">
            <select name="jewellery_brand">
              <option value="">Select brand</option>
              <option value="Cartier" selected>Cartier</option>
            </select>
          </div>
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    formFields.prepareControlsForSubmit(form)

    expect(formPayload(form)).toEqual([
      ['watch_brand', 'Rolex'],
      ['jewellery_brand', 'Cartier'],
      ['brands', 'Rolex,Cartier'],
    ])
  })

  it('keeps step-hidden fields enabled for Webflow multi-step payloads', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-step data-form-state="step-hidden hidden">
          <input name="first_step_value" value="keep-me">
        </div>
        <div data-form-step>
          <input name="current_step_value" value="also-keep">
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    formFields.prepareControlsForSubmit(form)

    expect(formPayload(form)).toEqual([
      ['first_step_value', 'keep-me'],
      ['current_step_value', 'also-keep'],
    ])
  })

  // RENAMED 9 Sep 2026. This used to claim condition-hidden fields "are not
  // submitted", asserted with new FormData(form) — which omits disabled controls
  // and so agreed. Webflow's own serialiser has no :not(:disabled) and submits
  // them anyway, so the claim was false in production. What the bundle actually
  // does is DISABLE them, which stops native constraint validation focusing an
  // invisible field but does not remove the key. Only renaming removes a key.
  it('disables condition-hidden fields, which does NOT keep them out of the payload', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <input type="hidden" name="active_hidden" value="keep">
        <div data-form-show-if="enquiry_type=Consignment" data-form-state="condition-hidden">
          <input type="hidden" name="dead_hidden" value="drop-hidden">
          <input type="text" name="dead_text" value="drop-text">
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    const deadHidden = form.root.querySelector('[name="dead_hidden"]')
    const deadText = form.root.querySelector('[name="dead_text"]')

    expect(deadHidden.disabled).toBe(false)
    expect(deadText.disabled).toBe(false)
    expect(deadText.closest('[data-form-show-if]').style.display).toBe('none')
    formFields.prepareControlsForSubmit(form)
    expect(deadHidden.disabled).toBe(true)
    expect(deadText.disabled).toBe(true)

    // The consequence, asserted so it cannot be forgotten again: both dead
    // fields still reach Zapier, carrying answers from a branch the customer
    // abandoned. Nothing clears a hidden branch's values — formFields.clear()
    // resets the whole form, not one branch.
    expect(formPayload(form)).toEqual([
      ['active_hidden', 'keep'],
      ['dead_hidden', 'drop-hidden'],
      ['dead_text', 'drop-text'],
    ])
  })

  it('still disables condition-hidden fields when inline display hiding is off (still submitted)', () => {
    document.body.innerHTML = `
      <form data-form="quote" data-form-condition-mode="inline-hide-off">
        <input type="hidden" name="active_hidden" value="keep">
        <div data-form-show-if="enquiry_type=Consignment" data-form-state="condition-hidden">
          <input type="text" name="dead_text" value="drop-text">
        </div>
      </form>
    `

    const form = bootForm(document.querySelector('form'))
    const deadText = form.root.querySelector('[name="dead_text"]')

    expect(deadText.disabled).toBe(false)
    formFields.prepareControlsForSubmit(form)
    expect(deadText.disabled).toBe(true)
    expect(deadText.style.display).not.toBe('none')
    expect(formPayload(form)).toEqual([
      ['active_hidden', 'keep'],
      ['dead_text', 'drop-text'],
    ])
  })

  it('uses the shortened required upload copy', () => {
    document.body.innerHTML = `
      <div data-form-upload data-form-field-required="true">
        <input type="hidden" data-form-upload-value>
        <div data-form-error></div>
      </div>
    `

    const upload = document.querySelector('[data-form-upload]')
    expect(formUploads.validate(upload)).toBe(false)
    expect(upload.querySelector('[data-form-error]').textContent).toBe('Upload file')
  })

  it('keeps spaces in model names', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-field="model">
          <input name="model" value="Submariner Date">
          <div data-form-error></div>
        </div>
      </form>
    `

    const input = document.querySelector('[name="model"]')
    formFields.applyFieldType(input)
    formFields.filterInput(input)

    expect(input.value).toBe('Submariner Date')
  })

  it('names required upload errors from the upload field', () => {
    document.body.innerHTML = `
      <div data-form-upload="front_image" data-form-field-required="true">
        <input type="hidden" data-form-upload-value>
        <div data-form-error></div>
      </div>
      <div data-form-upload="back_image" data-form-field-required="true">
        <input type="hidden" data-form-upload-value>
        <div data-form-error></div>
      </div>
    `

    const uploads = document.querySelectorAll('[data-form-upload]')
    expect(formUploads.validate(uploads[0])).toBe(false)
    expect(formUploads.validate(uploads[1])).toBe(false)
    expect(uploads[0].querySelector('[data-form-error]').textContent).toBe('Upload front image')
    expect(uploads[1].querySelector('[data-form-error]').textContent).toBe('Upload back image')
  })

  it('shows upload progress state immediately after a valid file is selected', () => {
    document.body.innerHTML = `
      <form data-form="test">
        <div data-form-upload="photo">
          <input type="hidden" data-form-upload-value>
          <span data-form-upload-name></span>
          <div data-form-error></div>
        </div>
      </form>
    `

    const upload = document.querySelector('[data-form-upload]')
    const file = new File(['image'], 'watch.jpg', { type: 'image/jpeg' })
    const originalUploadToWorker = formUploads.uploadToWorker
    formUploads.uploadToWorker = vi.fn(() => new Promise(() => {}))

    formUploads.handle({ root: document.querySelector('form') }, upload, file)

    expect(upload.getAttribute('data-form-state')).toContain('loading')
    expect(upload.querySelector('[data-form-upload-name]').textContent).toBe('Uploading watch.jpg...')

    formUploads.uploadToWorker = originalUploadToWorker
  })

  it('clears negative gold weight values instead of converting them to positives', () => {
    document.body.innerHTML = `
      <form data-form="gold">
        <div data-form-field="weight_grams">
          <input name="weight_grams" value="-abc1001!!">
          <div data-form-error></div>
        </div>
      </form>
    `

    const root = document.querySelector('form')
    const input = root.querySelector('[name="weight_grams"]')

    formFields.applyFieldType(input)
    formFields.filterInput(input)

    expect(input.getAttribute('inputmode')).toBe('decimal')
    expect(input.value).toBe('')
  })

  it('applies numeric filtering and max validation to gold weight fields', () => {
    document.body.innerHTML = `
      <form data-form="gold">
        <div data-form-field="weight_grams">
          <input name="weight_grams" value="1001!!">
          <div data-form-error></div>
        </div>
      </form>
    `

    const root = document.querySelector('form')
    const input = root.querySelector('[name="weight_grams"]')

    formFields.applyFieldType(input)
    formFields.filterInput(input)

    expect(input.getAttribute('inputmode')).toBe('decimal')
    expect(input.value).toBe('1,001')
    expect(formFields.validateField({ root }, input)).toBe(false)
    expect(root.querySelector('[data-form-error]').textContent).toBe('Enter a valid weight up to 1,000g.')
  })

  it('applies decimal keyboard and max validation to all configured gold gram fields', () => {
    const names = [
      'weight_grams',
      'weight_grams_9ct',
      'weight_grams_14ct',
      'weight_grams_18ct',
      'weight_grams_22ct',
      'weight_grams_24ct',
    ]

    names.forEach((name) => {
      document.body.innerHTML = `
        <form data-form="gold">
          <div data-form-field="${name}">
            <input name="${name}" value="1,000.5abc">
            <div data-form-error></div>
          </div>
        </form>
      `

      const root = document.querySelector('form')
      const input = root.querySelector(`[name="${name}"]`)

      formFields.applyFieldType(input)
      formFields.filterInput(input)

      expect(input.getAttribute('inputmode')).toBe('decimal')
      expect(input.value).toBe('1,000.5')
      expect(formFields.validateField({ root }, input)).toBe(false)
      expect(root.querySelector('[data-form-error]').textContent).toBe('Enter a valid weight up to 1,000g.')
    })
  })

  it('clears negative quantity values instead of converting them to positives', () => {
    document.body.innerHTML = `
      <form data-form="gold">
        <div data-form-field="quantity">
          <input name="quantity" value="-2abc!!">
          <div data-form-error></div>
        </div>
      </form>
    `

    const input = document.querySelector('[name="quantity"]')

    formFields.applyFieldType(input)
    formFields.filterInput(input)

    expect(input.getAttribute('inputmode')).toBe('numeric')
    expect(input.value).toBe('')
  })

  it('uses quantity rules for repeated gold quantity field names', () => {
    document.body.innerHTML = `
      <form data-form="gold">
        <div data-form-field="quantity_item_2">
          <input name="quantity_item_2" value="3abc">
          <div data-form-error></div>
        </div>
      </form>
    `

    const input = document.querySelector('[name="quantity_item_2"]')

    formFields.applyFieldType(input)
    formFields.filterInput(input)

    expect(input.getAttribute('inputmode')).toBe('numeric')
    expect(input.value).toBe('3')
    expect(formFields.validateField({ root: document.querySelector('form') }, input)).toBe(true)
  })

  it('hides elements on step 1 via step condition logic', () => {
    document.body.innerHTML = `
      <form data-form="multistep">
        <div data-form-step>
          <input name="first_name" value="Ada">
          <button type="button" data-form-action="next">Next</button>
        </div>
        <div data-form-step>
          <input name="last_name" value="Lovelace">
        </div>
        <button type="button" data-form-hide-if="step = 1" id="back-btn">Back</button>
        <p data-form-show-if="step >= 2" id="progress-copy">Almost there</p>
      </form>
    `

    const root = document.querySelector('form')
    const form = {
      root,
      scope: root,
      key: 'multistep',
      steps: Array.from(root.querySelectorAll('[data-form-step]')),
      stepIndex: 0,
      syncedFieldKeys: new Set(),
    }

    formApp.refresh(form)

    const backBtn = root.querySelector('#back-btn')
    const progressCopy = root.querySelector('#progress-copy')

    expect(backBtn.getAttribute('data-form-state')).toContain('condition-hidden')
    expect(progressCopy.getAttribute('data-form-state')).toContain('condition-hidden')

    formSteps.goBy(form, 1)
    formApp.refresh(form)

    expect(backBtn.getAttribute('data-form-state') || '').not.toContain('condition-hidden')
    expect(progressCopy.getAttribute('data-form-state') || '').not.toContain('condition-hidden')
  })

  it('clears product finder filters back to the unfiltered card state', () => {
    document.body.innerHTML = `
      <form data-form="product-finder" data-form-condition-mode="inline-hide-off">
        <div data-form-field="asset_type">
          <select name="asset_type">
            <option value="">Select an asset</option>
            <option value="watch">Watches</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="product-card-wrap" data-form-hide-if-any="asset_type = other">
          <a class="product-card">Pawnbroking Loans</a>
        </div>
      </form>
    `

    const root = document.querySelector('form')
    const form = {
      root,
      scope: root,
      key: 'product-finder',
      steps: [],
      stepIndex: 0,
      syncedFieldKeys: new Set(),
    }
    const select = root.querySelector('select')
    const card = root.querySelector('.product-card')

    select.value = 'other'
    formFields.setFilled(select)
    formApp.refresh(form)
    expect(card.getAttribute('data-form-state')).toContain('condition-hidden')

    formFields.clear(form)
    formApp.refresh(form)

    expect(select.value).toBe('')
    expect(select.getAttribute('data-form-state') || '').not.toContain('filled')
    expect(card.getAttribute('data-form-state') || '').not.toContain('condition-hidden')
  })

  it('emits a generic form change event after field changes refresh visibility', async () => {
    document.body.innerHTML = `
      <form data-form="generic-form">
        <div data-form-field="asset_type">
          <select name="asset_type">
            <option value="">Select an asset</option>
            <option value="watch">Watches</option>
          </select>
        </div>
        <div id="result" data-form-show-if="asset_type = watch">Result</div>
      </form>
    `

    const root = document.querySelector('form')
    const form = {
      root,
      scope: root,
      key: 'generic-form',
      steps: [],
      stepIndex: 0,
      syncedFieldKeys: new Set(),
    }
    const select = root.querySelector('select')
    const result = root.querySelector('#result')
    const listener = vi.fn()

    root.addEventListener('suttons:form-change', listener)

    select.value = 'watch'
    await formEvents.handleChange(form, { target: select })

    expect(result.getAttribute('data-form-state') || '').not.toContain('condition-hidden')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].detail.reason).toBe('change')
    expect(listener.mock.calls[0][0].detail.form).toBe(form)
  })

  it('uses partial show-if matching for inline finder result cards', () => {
    document.body.innerHTML = `
      <form data-form="fulfilment-finder" data-form-condition-mode="inline-hide-off">
        <select name="asset_type">
          <option value="">Select an asset</option>
          <option value="Watches">Watches</option>
          <option value="Other">Other</option>
        </select>
        <select name="requested_amount">
          <option value="">Select an amount</option>
          <option value="amount_250_499">£250 to £499</option>
          <option value="amount_40000_plus">£40,000+</option>
        </select>
        <select name="client_region">
          <option value="">Select a region</option>
          <option value="Greater London">Greater London</option>
        </select>
        <select name="money_urgency">
          <option value="">Select a timeframe</option>
          <option value="urgency_same_day">Same day</option>
          <option value="urgency_2_3_days">Two to three days</option>
        </select>
        <div id="watch-card" class="product-card-wrap" data-form-show-if="asset_type = Watches, requested_amount = amount_250_499|amount_40000_plus, client_region = Greater London, money_urgency = urgency_same_day">
          Watch result
        </div>
        <div id="other-card" class="product-card-wrap" data-form-show-if="asset_type = Other, requested_amount = amount_40000_plus, client_region = Greater London, money_urgency = urgency_2_3_days">
          Other result
        </div>
      </form>
    `

    const root = document.querySelector('form')
    const form = bootForm(root)
    const watchCard = root.querySelector('#watch-card')
    const otherCard = root.querySelector('#other-card')

    expect(watchCard.getAttribute('data-form-state') || '').not.toContain('condition-hidden')
    expect(otherCard.getAttribute('data-form-state') || '').not.toContain('condition-hidden')

    root.querySelector('[name="asset_type"]').value = 'Watches'
    formApp.refresh(form)

    expect(watchCard.getAttribute('data-form-state') || '').not.toContain('condition-hidden')
    expect(otherCard.getAttribute('data-form-state')).toContain('condition-hidden')

    root.querySelector('[name="requested_amount"]').value = 'amount_40000_plus'
    root.querySelector('[name="client_region"]').value = 'Greater London'
    root.querySelector('[name="money_urgency"]').value = 'urgency_same_day'
    formApp.refresh(form)

    expect(watchCard.getAttribute('data-form-state') || '').not.toContain('condition-hidden')
    expect(otherCard.getAttribute('data-form-state')).toContain('condition-hidden')
  })

  it('forces success redirect pages to the top when they carry form reference params', () => {
    const scrollTo = vi.fn()
    const originalScrollTo = window.scrollTo
    window.scrollTo = scrollTo
    window.history.replaceState({}, '', '/thank-you/?form=get-a-quote&reference=SR-123')

    formSuccessPage.scrollToTopIfNeeded()

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
    window.scrollTo = originalScrollTo
    window.history.replaceState({}, '', '/')
  })

  it('scrolls to the top of the next step when advancing a multi-step form', () => {
    document.body.innerHTML = `
      <form data-form="multistep">
        <div data-form-step>
          <input name="first_name" value="Ada">
          <button type="button" data-form-action="next">Next</button>
        </div>
        <div data-form-step>
          <input name="last_name" value="Lovelace">
        </div>
      </form>
    `

    const root = document.querySelector('form')
    const form = {
      root,
      scope: root,
      key: 'multistep',
      steps: Array.from(root.querySelectorAll('[data-form-step]')),
      stepIndex: 0,
      syncedFieldKeys: new Set(),
    }
    formApp.refresh(form)

    // Simulate the "retained scroll near the footer after a tall step
    // collapsed" state: the active step now sits above the viewport.
    const nextStep = form.steps[1]
    nextStep.getBoundingClientRect = () => ({ top: -400, left: 0, bottom: 0, right: 0, width: 0, height: 0 })
    Object.defineProperty(window, 'pageYOffset', { value: 900, configurable: true })

    // Run rAF callbacks synchronously so we can assert on the scroll.
    const originalRaf = window.requestAnimationFrame
    window.requestAnimationFrame = (cb) => { cb(); return 0 }
    const scrollTo = vi.fn()
    const originalScrollTo = window.scrollTo
    window.scrollTo = scrollTo

    try {
      formSteps.goBy(form, 1)
    } finally {
      window.requestAnimationFrame = originalRaf
      window.scrollTo = originalScrollTo
    }

    // Advanced to step 2 and scrolled up to its top (900 + (-400) - 20 = 480).
    expect(form.stepIndex).toBe(1)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 480, left: 0 }),
    )
  })

  it('stores and hydrates Get a Quote success output fields', () => {
    document.body.innerHTML = `
      <form data-form="get-a-quote">
        <input name="lead_reference" value="JONES-123">
        <input name="email" value="client@example.com">
        <input name="enquiry_type" value="Loan against item">
        <select name="requested_amount">
          <option value="£3,000 - £4,999" selected>£3,000 - £4,999</option>
        </select>
        <label><input type="checkbox" name="contact_method" value="Email" checked>Email</label>
        <label><input type="checkbox" name="contact_method" value="Phone" checked>Phone</label>
      </form>
      <section>
        <div data-form-success-field="reference">Reference <span data-form-success-output="reference"></span></div>
        <div data-form-success-field="email">Email <span data-form-success-output="email"></span></div>
        <div data-form-success-field="requested_amount">Amount <span data-form-success-output="requested_amount"></span></div>
        <div data-form-success-field="contact_method">Contact <span data-form-success-output="contact_method"></span></div>
        <div data-form-success-field="asset_type">Asset <span data-form-success-output="asset_type"></span></div>
      </section>
    `

    const root = document.querySelector('form')
    const form = { root, key: 'get-a-quote' }
    formAttribution.storeSuccessSnapshot(form, { uniqueId: 'JONES-123' })

    window.history.replaceState({}, '', '/thank-you/get-a-quote?form=get-a-quote&Reference=JONES-123')
    formSuccessPage.hydrateOutputs(document)

    // PII minimisation (documented in the developer docs of the private
    // companion repo): reference hydrates; email, requested_amount and
    // contact_method are no longer persisted, so their rows stay empty/hidden
    // even when a page fabricates output hooks for them.
    expect(document.querySelector('[data-form-success-output="reference"]').textContent).toBe('JONES-123')
    expect(document.querySelector('[data-form-success-output="email"]').textContent).toBe('')
    expect(document.querySelector('[data-form-success-field="email"]').hidden).toBe(true)
    expect(document.querySelector('[data-form-success-field="requested_amount"]').hidden).toBe(true)
    expect(document.querySelector('[data-form-success-field="contact_method"]').hidden).toBe(true)
    expect(document.querySelector('[data-form-success-field="asset_type"]').hidden).toBe(true)

    window.history.replaceState({}, '', '/')
  })

  it('stores and hydrates Appointment success output fields', () => {
    document.body.innerHTML = `
      <form data-form="appointment">
        <input name="lead_reference" value="APPT-456">
        <input name="email" value="client@example.com">
        <select name="showroom">
          <option value="South Kensington" selected>South Kensington</option>
        </select>
        <input name="appointment_date" value="2026-07-02">
        <input name="appointment_time" value="10:30">
        <label><input type="checkbox" name="contact_method_email" value="Email" checked>Email</label>
        <label><input type="checkbox" name="contact_method_phone" value="Phone" checked>Phone</label>
      </form>
      <section>
        <div data-form-success-field="reference">Reference <span data-form-success-output="reference"></span></div>
        <div data-form-success-field="email">Email <span data-form-success-output="email"></span></div>
        <div data-form-success-field="appointment_location">Showroom <span data-form-success-output="appointment_location"></span></div>
        <div data-form-success-field="appointment_date">Date <span data-form-success-output="appointment_date"></span></div>
        <div data-form-success-field="appointment_time">Time <span data-form-success-output="appointment_time"></span></div>
        <div data-form-success-field="contact_method">Contact <span data-form-success-output="contact_method"></span></div>
        <div data-form-success-field="asset_type">Asset <span data-form-success-output="asset_type"></span></div>
      </section>
    `

    const root = document.querySelector('form')
    const form = { root, key: 'appointment' }
    formAttribution.storeSuccessSnapshot(form, { uniqueId: 'APPT-456' })

    window.history.replaceState({}, '', '/thank-you/appointment?form=appointment&Reference=APPT-456')
    formSuccessPage.hydrateOutputs(document)

    expect(document.querySelector('[data-form-success-output="reference"]').textContent).toBe('APPT-456')
    expect(document.querySelector('[data-form-success-field="email"]').hidden).toBe(true)
    expect(document.querySelector('[data-form-success-field="appointment_location"]').hidden).toBe(true)
    expect(document.querySelector('[data-form-success-field="appointment_date"]').hidden).toBe(true)
    expect(document.querySelector('[data-form-success-field="appointment_time"]').hidden).toBe(true)
    expect(document.querySelector('[data-form-success-field="contact_method"]').hidden).toBe(true)
    expect(document.querySelector('[data-form-success-field="asset_type"]').hidden).toBe(true)

    window.history.replaceState({}, '', '/')
  })

  it('stores and hydrates Gold contact confirmation output fields', () => {
    document.body.innerHTML = `
      <form data-form="gold">
        <input name="lead_reference" value="GOLD-789">
        <input name="email" value="gold-client@example.com">
        <label><input type="checkbox" name="contact_method_whatsapp" value="WhatsApp" checked>WhatsApp</label>
      </form>
      <section>
        <div data-form-success-field="reference">Reference <span data-form-success-output="reference"></span></div>
        <div data-form-success-field="email">Email <span data-form-success-output="email"></span></div>
        <div data-form-success-field="contact_method">Contact <span data-form-success-output="contact_method"></span></div>
      </section>
    `

    const root = document.querySelector('form')
    const form = { root, key: 'gold' }
    formAttribution.storeSuccessSnapshot(form, { uniqueId: 'GOLD-789' })

    window.history.replaceState({}, '', '/thank-you/gold?form=gold&Reference=GOLD-789')
    formSuccessPage.hydrateOutputs(document)

    expect(document.querySelector('[data-form-success-output="reference"]').textContent).toBe('GOLD-789')
    expect(document.querySelector('[data-form-success-field="email"]').hidden).toBe(true)
    expect(document.querySelector('[data-form-success-field="contact_method"]').hidden).toBe(true)

    window.history.replaceState({}, '', '/')
  })

  it('stores and hydrates Courier success output fields', () => {
    document.body.innerHTML = `
      <form data-form="courier">
        <input name="lead_reference" value="COUR-234">
        <input name="email" value="courier-client@example.com">
        <label><input type="radio" name="courier_option" value="Request a courier pack" checked>Request a courier pack</label>
        <label><input type="checkbox" name="contact_method_email" value="Email" checked>Email</label>
      </form>
      <section>
        <div data-form-success-field="reference">Reference <span data-form-success-output="reference"></span></div>
        <div data-form-success-field="email">Email <span data-form-success-output="email"></span></div>
        <div data-form-success-field="courier_option">Courier option <span data-form-success-output="courier_option"></span></div>
        <div data-form-success-field="contact_method">Contact <span data-form-success-output="contact_method"></span></div>
      </section>
    `

    const root = document.querySelector('form')
    const form = { root, key: 'courier' }
    formAttribution.storeSuccessSnapshot(form, { uniqueId: 'COUR-234' })

    window.history.replaceState({}, '', '/thank-you/courier?form=courier&Reference=COUR-234')
    formSuccessPage.hydrateOutputs(document)

    expect(document.querySelector('[data-form-success-output="reference"]').textContent).toBe('COUR-234')
    expect(document.querySelector('[data-form-success-field="email"]').hidden).toBe(true)
    expect(document.querySelector('[data-form-success-field="courier_option"]').hidden).toBe(true)
    expect(document.querySelector('[data-form-success-field="contact_method"]').hidden).toBe(true)

    window.history.replaceState({}, '', '/')
  })

  it('puts loan enquiry copy in help text rather than every result field', async () => {
    document.body.innerHTML = `
      <form data-form-loan>
        <input data-form-loan-amount value="20000">
        <input type="radio" name="loan_duration" value="3" checked>
        <span data-form-loan-output="interest_rate"></span>
        <span data-form-loan-output="monthly_interest"></span>
        <span data-form-loan-output="total_interest"></span>
        <span data-form-loan-output="total_redeem"></span>
        <p data-form-loan-output="help"></p>
      </form>
    `

    initLoanForms(document)
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(document.querySelector('[data-form-loan-output="interest_rate"]').textContent).toBe('')
    expect(document.querySelector('[data-form-loan-output="monthly_interest"]').textContent).toBe('')
    expect(document.querySelector('[data-form-loan-output="total_interest"]').textContent).toBe('')
    expect(document.querySelector('[data-form-loan-output="total_redeem"]').textContent).toBe('')
    expect(document.querySelector('[data-form-loan-output="help"]').textContent).toBe('')
  })

  it('does not thank-you redirect until Webflow success follows a user submit', async () => {
    document.body.innerHTML = `
      <div class="w-form">
        <form data-form="resources-form" data-form-thank-you="/thank-you-subscribing" id="resources-form">
          <input type="email" name="email" value="test@example.com" required>
          <button type="submit">Subscribe</button>
        </form>
        <div class="w-form-done" style="display: block">Thank you</div>
        <div class="w-form-fail" style="display: none"></div>
      </div>
    `

    const root = document.querySelector('form')
    const form = {
      root,
      key: 'resources-form',
      scope: root.closest('.w-form'),
      steps: [],
      stepIndex: 0,
      syncedFieldKeys: new Set(),
    }

    const redirectSpy = vi.spyOn(formAttribution, 'redirectToThankYou').mockImplementation(() => {})

    formEvents.bind(form)
    expect(redirectSpy).not.toHaveBeenCalled()

    form.isSubmitting = true
    const done = document.querySelector('.w-form-done')
    done.style.display = 'none'
    done.style.display = 'block'

    await vi.waitFor(() => {
      expect(redirectSpy).toHaveBeenCalledTimes(1)
    })
    redirectSpy.mockRestore()
  })

  it('pushes the GTM form event before Webflow can navigate direct submissions', async () => {
    document.body.innerHTML = `
      <div class="w-form">
        <form data-form="footer-form" data-form-thank-you="/thank-you-subscribing" id="footer-form">
          <input type="email" name="email" value="direct@example.com" required>
          <button type="submit">Subscribe</button>
        </form>
        <div class="w-form-done" style="display: none">Thank you</div>
        <div class="w-form-fail" style="display: none"></div>
      </div>
    `

    window.dataLayer = []
    const root = document.querySelector('form')
    const form = {
      root,
      key: 'footer-form',
      scope: root.closest('.w-form'),
      steps: [],
      stepIndex: 0,
      syncedFieldKeys: new Set(),
    }
    const redirectSpy = vi.spyOn(formAttribution, 'redirectToThankYou').mockImplementation(() => {})

    formEvents.bind(form)
    root.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    expect(window.dataLayer).toContainEqual(expect.objectContaining({
      event: 'form_submission',
      form_name: 'footer-form',
      form_status: 'success',
      email: 'direct@example.com',
      phone: '',
    }))

    const done = document.querySelector('.w-form-done')
    done.style.display = 'block'

    await vi.waitFor(() => {
      expect(redirectSpy).toHaveBeenCalledTimes(1)
    })
    expect(window.dataLayer.filter((item) => item.event === 'form_submission')).toHaveLength(1)

    delete window.dataLayer
    redirectSpy.mockRestore()
  })
})
