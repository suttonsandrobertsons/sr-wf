import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formSync, SYNC_FORM_MODES } from '../core/sync.js'
import { formApp } from '../core/app.js'
import { formEvents, initSyncSubmitGuard } from '../core/events.js'
import { formAttribution } from '../core/attribution.js'
import { formRedirect } from '../core/redirect.js'
import { initForms } from '../index.js'

function makeSyncForm({ mode = 'sync', target = 'footer-form', fields = '' } = {}) {
  document.body.innerHTML = `
    <form data-form="footer-form" id="footer-form">
      <div data-form-field="email">
        <input type="email" name="email" required>
      </div>
      <button type="submit">Footer</button>
    </form>
    <form data-form="resources-form" id="resources-form"
          data-form-mode="${mode}"
          data-form-sync-form="${target}"
          ${fields ? `data-form-sync-fields="${fields}"` : ''}>
      <div data-form-field="email">
        <input type="email" name="email" required>
      </div>
      <button type="submit">Subscribe</button>
    </form>
  `

  formApp.boot(document)
  return {
    source: document.querySelector('#resources-form'),
    target: document.querySelector('#footer-form'),
  }
}

describe('formSync', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    formApp.forms.clear()
    formApp.formKeys.clear()
  })

  it('recognises sync via data-form-sync-form without data-form-mode', () => {
    const root = document.createElement('form')
    root.setAttribute('data-form-sync-form', 'footer-form')
    expect(formSync.isSync({ root })).toBe(true)
  })

  it('recognises mirror and sync modes', () => {
    expect(SYNC_FORM_MODES.has('mirror')).toBe(true)
    expect(SYNC_FORM_MODES.has('sync')).toBe(true)

    const root = document.createElement('form')
    root.setAttribute('data-form-mode', 'sync')
    expect(formSync.isSync({ root })).toBe(true)

    root.setAttribute('data-form-mode', 'mirror')
    expect(formSync.isSync({ root })).toBe(true)

    root.setAttribute('data-form-mode', 'redirect')
    expect(formSync.isSync({ root })).toBe(false)
  })

  it('resolves target form from data-form-sync-form', () => {
    const { source, target } = makeSyncForm()
    const sourceForm = formApp.getFormByRoot(source)

    expect(formSync.getTargetRoot(sourceForm)).toBe(target)
  })

  it('copies matching fields and submits the target form', () => {
    const click = vi.fn()
    const { source, target } = makeSyncForm()
    const sourceForm = formApp.getFormByRoot(source)
    const submitBtn = target.querySelector('button[type="submit"]')
    vi.spyOn(submitBtn, 'click').mockImplementation(click)

    source.querySelector('input[name="email"]').value = 'sync-test@example.com'

    const ok = formSync.submitToTarget(sourceForm)

    expect(ok).toBe(true)
    expect(target.querySelector('input[name="email"]').value).toBe('sync-test@example.com')
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('mirrors cleared source values to the target', () => {
    const { source, target } = makeSyncForm()
    const sourceInput = source.querySelector('input[name="email"]')
    const targetInput = target.querySelector('input[name="email"]')

    sourceInput.value = 'clear-me@example.com'
    sourceInput.dispatchEvent(new Event('input', { bubbles: true }))
    expect(targetInput.value).toBe('clear-me@example.com')

    sourceInput.value = ''
    sourceInput.dispatchEvent(new Event('input', { bubbles: true }))
    expect(targetInput.value).toBe('')
  })

  it('supports explicit field mappings via data-form-sync-fields', () => {
    document.body.innerHTML = `
      <form data-form="footer-form" id="footer-form">
        <input type="email" name="email">
      </form>
      <form data-form="cta-form" data-form-mode="sync" data-form-sync-form="footer-form"
            data-form-sync-fields="newsletter_email:email">
        <input type="email" name="newsletter_email" value="mapped@example.com">
      </form>
    `

    formApp.boot(document)
    const sourceForm = formApp.getFormByRoot(document.querySelector('form[data-form="cta-form"]'))
    const target = document.querySelector('#footer-form')
    const submitBtn = document.createElement('button')
    submitBtn.type = 'submit'
    target.appendChild(submitBtn)
    vi.spyOn(submitBtn, 'click').mockImplementation(() => {})

    formSync.submitToTarget(sourceForm)

    expect(target.querySelector('input[name="email"]').value).toBe('mapped@example.com')
  })

  it('fails when sync target is missing', () => {
    document.body.innerHTML = `
      <form data-form="cta-form" data-form-mode="sync" data-form-sync-form="missing-form">
        <input type="email" name="email" value="a@example.com">
      </form>
    `

    formApp.boot(document)
    const sourceForm = formApp.getFormByRoot(document.querySelector('form[data-form="cta-form"]'))
    expect(sourceForm).toBeTruthy()

    expect(formSync.submitToTarget(sourceForm)).toBe(false)
  })

  it('treats same-page redirect mode with redirect-form as sync hand-off', () => {
    const click = vi.fn()
    const samePageAction = `${window.location.origin}${window.location.pathname}#resources`

    document.body.innerHTML = `
      <form data-form="footer-form" id="footer-form">
        <input type="email" name="email">
        <button type="submit">Go</button>
      </form>
      <form data-form="resources-form" id="resources-form"
            data-form-mode="redirect"
            data-form-redirect-form="footer-form"
            action="${samePageAction}">
        <input type="email" name="email" value="redirect-sync@example.com">
        <button type="submit">Go</button>
      </form>
    `

    formApp.boot(document)
    const sourceForm = formApp.getFormByRoot(document.querySelector('#resources-form'))
    const target = document.querySelector('#footer-form')
    const submitBtn = target.querySelector('button[type="submit"]')
    vi.spyOn(submitBtn, 'click').mockImplementation(click)

    expect(formSync.isSync(sourceForm)).toBe(true)

    const event = new Event('submit', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: sourceForm.root })
    Object.defineProperty(event, 'currentTarget', { value: sourceForm.root })

    formEvents.handleSubmit(sourceForm, event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.querySelector('#footer-form input[name="email"]').value).toBe('redirect-sync@example.com')
    expect(click).toHaveBeenCalled()
  })

  it('guards unbooted sync form with method=get (injected Webflow markup)', () => {
    const click = vi.fn()

    document.body.innerHTML = `
      <form data-form="footer-form" id="footer-form" data-form-thank-you="/thank-you-subscribing">
        <input type="email" name="email">
        <button type="submit">Footer</button>
      </form>
      <div class="footer_subscribe-form-block w-form">
        <form method="get" class="footer_subscribe-input-wrap" data-form="resources-form"
              data-form-mode="sync" data-form-sync-form="footer-form" id="resources-form">
          <input type="email" name="email" data-form-field="email" required class="footer-subscribe_input">
          <button type="submit">Go</button>
        </form>
        <div class="w-form-done"></div>
        <div class="w-form-fail"></div>
      </div>
    `

    initSyncSubmitGuard()

    const resources = document.querySelector('#resources-form')
    const footerBtn = document.querySelector('#footer-form button[type="submit"]')
    vi.spyOn(footerBtn, 'click').mockImplementation(click)

    resources.querySelector('input[name="email"]').value = 'injected@example.com'

    expect(resources.getAttribute('method')).toBe('get')

    resources.querySelector('button[type="submit"]').click()

    expect(resources.getAttribute('method')).toBe('post')
    expect(document.querySelector('#footer-form input[name="email"]').value).toBe('injected@example.com')
    expect(click).toHaveBeenCalled()
  })

  it('boots sync forms inside open shadow roots', () => {
    document.body.innerHTML = `
      <form data-form="footer-form" id="footer-form">
        <input type="email" name="email">
        <button type="submit">Footer</button>
      </form>
      <div id="host"></div>
    `

    const shadow = document.querySelector('#host').attachShadow({ mode: 'open' })
    shadow.innerHTML = `
      <div class="footer_subscribe-form-block w-form">
        <form method="get" data-form="resources-form" data-form-mode="sync"
              data-form-sync-form="footer-form" id="resources-form">
          <input type="email" name="email" data-form-field="email">
          <button type="submit">Go</button>
        </form>
        <div class="w-form-done"></div>
        <div class="w-form-fail"></div>
      </div>
    `

    initForms(document)

    const resources = shadow.querySelector('#resources-form')
    expect(resources.getAttribute('method')).toBe('post')
    expect(resources.getAttribute('data-form-state')).toContain('loaded')
    expect(formApp.getFormByRoot(resources)).toBeTruthy()
  })

  it('guards unbooted shadow sync forms with method=get', () => {
    const click = vi.fn()

    document.body.innerHTML = `
      <form data-form="footer-form" id="footer-form">
        <input type="email" name="email">
        <button type="submit">Footer</button>
      </form>
      <div id="host"></div>
    `

    const shadow = document.querySelector('#host').attachShadow({ mode: 'open' })
    shadow.innerHTML = `
      <form method="get" data-form="resources-form" data-form-mode="sync"
            data-form-sync-form="footer-form" id="resources-form">
        <input type="email" name="email" data-form-field="email">
        <button type="submit">Go</button>
      </form>
    `

    initSyncSubmitGuard()

    const resources = shadow.querySelector('#resources-form')
    const footerBtn = document.querySelector('#footer-form button[type="submit"]')
    vi.spyOn(footerBtn, 'click').mockImplementation(click)

    resources.querySelector('input[name="email"]').value = 'shadow@example.com'
    resources.querySelector('button[type="submit"]').click()

    expect(resources.getAttribute('method')).toBe('post')
    expect(document.querySelector('#footer-form input[name="email"]').value).toBe('shadow@example.com')
    expect(click).toHaveBeenCalled()
  })

  it('handleSubmit proxies sync forms to the target without native POST on source', () => {
    const click = vi.fn()
    const { source, target } = makeSyncForm()
    const sourceForm = formApp.getFormByRoot(source)
    const submitBtn = target.querySelector('button[type="submit"]')
    vi.spyOn(submitBtn, 'click').mockImplementation(click)

    source.querySelector('input[name="email"]').value = 'event-sync@example.com'

    const event = new Event('submit', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: source })
    Object.defineProperty(event, 'currentTarget', { value: source })

    formEvents.handleSubmit(sourceForm, event)

    expect(event.defaultPrevented).toBe(true)
    expect(target.querySelector('input[name="email"]').value).toBe('event-sync@example.com')
    expect(click).toHaveBeenCalled()
  })

  it('tracks success on the target form after a sync source submits', async () => {
    document.body.innerHTML = `
      <div class="w-form">
        <form data-form="footer-form" id="footer-form" data-form-thank-you="/thank-you-subscribing">
          <input type="email" name="email">
          <button type="submit">Footer</button>
        </form>
        <div class="w-form-done" style="display: none"></div>
        <div class="w-form-fail" style="display: none"></div>
      </div>
      <form data-form="resources-form" id="resources-form"
            data-form-mode="sync" data-form-sync-form="footer-form">
        <input type="email" name="email" required>
        <button type="submit">Subscribe</button>
      </form>
    `

    formApp.boot(document)
    const sourceForm = formApp.getFormByRoot(document.querySelector('#resources-form'))
    const targetForm = formApp.getFormByRoot(document.querySelector('#footer-form'))
    const redirectSpy = vi.spyOn(formAttribution, 'redirectToThankYou').mockImplementation(() => {})
    vi.spyOn(formAttribution, 'pushDataLayer').mockImplementation(() => {})

    sourceForm.root.querySelector('input[name="email"]').value = 'success-sync@example.com'

    const event = new Event('submit', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: sourceForm.root })
    Object.defineProperty(event, 'currentTarget', { value: sourceForm.root })

    formEvents.handleSubmit(sourceForm, event)

    expect(event.defaultPrevented).toBe(true)
    expect(sourceForm.isSubmitting).toBeUndefined()
    expect(targetForm.isSubmitting).toBe(true)
    expect(targetForm.root.querySelector('input[name="email"]').value).toBe('success-sync@example.com')

    const done = targetForm.scope.querySelector('.w-form-done')
    done.style.display = 'block'
    done.setAttribute('data-form-state', 'success')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(targetForm.isSubmitting).toBe(false)
    expect(targetForm.hasTrackedSuccess).toBe(true)
    expect(redirectSpy).toHaveBeenCalledWith(targetForm)
  })
})

function makeSubmittableForm() {
  document.body.innerHTML = `
    <div class="w-form">
      <form data-form="lead-form" id="lead-form" data-form-thank-you="/thanks">
        <input type="email" name="email" required>
        <button type="submit">Send</button>
      </form>
      <div class="w-form-done" style="display: none">
        <button data-form-action="reset">Reset</button>
      </div>
      <div class="w-form-fail" style="display: none"></div>
    </div>
  `

  formApp.boot(document)
  return formApp.getFormByRoot(document.querySelector('#lead-form'))
}

describe('event lifecycle defects', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    formApp.forms.clear()
    formApp.formKeys.clear()
    vi.restoreAllMocks()
    vi.spyOn(formAttribution, 'pushDataLayer').mockImplementation(() => {})
    vi.spyOn(formAttribution, 'redirectToThankYou').mockImplementation(() => {})
  })

  it('re-establishes success tracking after a reconnected root is re-created', async () => {
    const parent = document.createElement('div')
    parent.innerHTML = `
      <div class="w-form">
        <form data-form="lead-form" id="lead-form" data-form-thank-you="/thanks">
          <input type="email" name="email" required>
          <button type="submit">Send</button>
        </form>
        <div class="w-form-done" style="display: none"></div>
        <div class="w-form-fail" style="display: none"></div>
      </div>
    `
    document.body.appendChild(parent)

    const wForm = parent.querySelector('.w-form')
    formApp.boot(document)
    const firstForm = formApp.getFormByRoot(document.querySelector('#lead-form'))
    expect(firstForm).toBeTruthy()

    // Detach, boot (prunes the disconnected root + drops the readyRoots latch),
    // then reattach the same subtree and boot again so it is re-created.
    wForm.remove()
    formApp.boot(document)
    parent.appendChild(wForm)
    formApp.boot(document)

    const liveForm = formApp.getFormByRoot(document.querySelector('#lead-form'))
    expect(liveForm).toBeTruthy()
    expect(liveForm).not.toBe(firstForm)
    expect(liveForm.successObserver).toBeTruthy()

    liveForm.root.querySelector('input[name="email"]').value = 'a@example.com'
    liveForm.root.querySelector('button[type="submit"]').click()
    expect(liveForm.isSubmitting).toBe(true)

    const done = liveForm.scope.querySelector('.w-form-done')
    done.style.display = 'block'
    done.setAttribute('data-form-state', 'success')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(liveForm.hasTrackedSuccess).toBe(true)
    expect(liveForm.isSubmitting).toBe(false)
  })

  it('revives success tracking after a reset so a second submit fires', async () => {
    const form = makeSubmittableForm()

    form.root.querySelector('input[name="email"]').value = 'first@example.com'
    form.root.querySelector('button[type="submit"]').click()
    expect(form.isSubmitting).toBe(true)

    const done = form.scope.querySelector('.w-form-done')
    done.style.display = 'block'
    done.setAttribute('data-form-state', 'success')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(form.hasTrackedSuccess).toBe(true)
    expect(form.isSubmitting).toBe(false)

    done.querySelector('[data-form-action="reset"]').click()
    expect(form.hasTrackedSuccess).toBe(false)
    expect(form.isSubmitting).toBe(false)

    form.root.querySelector('input[name="email"]').value = 'second@example.com'
    form.root.querySelector('button[type="submit"]').click()
    expect(form.isSubmitting).toBe(true)

    done.style.display = 'block'
    done.setAttribute('data-form-state', 'success-again')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(form.hasTrackedSuccess).toBe(true)
    expect(form.isSubmitting).toBe(false)
  })

  it('blocks a duplicate redirect submit via the isSubmitting guard', () => {
    document.body.innerHTML = `
      <form data-form="redirect-form" id="redirect-form" data-form-mode="redirect"
            data-form-redirect-url="https://example.com/next">
        <input type="email" name="email" value="dup@example.com">
        <button data-form-action="redirect">Go</button>
      </form>
    `

    formApp.boot(document)
    const form = formApp.getFormByRoot(document.querySelector('#redirect-form'))
    const submit = vi.spyOn(formRedirect, 'submit').mockImplementation(() => {})

    formEvents.runRedirectSubmit(form)
    expect(form.isSubmitting).toBe(true)
    expect(submit).toHaveBeenCalledTimes(1)

    formEvents.runRedirectSubmit(form)
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
