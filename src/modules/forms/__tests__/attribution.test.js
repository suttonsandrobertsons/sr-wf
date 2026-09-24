import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  formAttribution,
  formEvents,
  formFields,
  formRedirect,
  formValues,
  formDom,
  formSuccessPage,
} from '../core.js'
import { formConfig } from '../config.js'

function makeStorage(initial = {}, throwOnWrite = false) {
  let data = { ...initial }
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null },
    setItem(k, v) {
      if (throwOnWrite) throw new Error('quota')
      data[k] = String(v)
    },
    _data: () => data,
    _reset: (d = {}) => { data = { ...d } },
  }
}

function makeFormFixture() {
  const root = document.createElement('form')
  root.setAttribute('data-form', 'test')

  // last_name for lead reference prefix
  const last = document.createElement('input')
  last.name = 'last_name'
  last.value = 'Jones'
  root.appendChild(last)

  // contact fields for quote_url
  const first = document.createElement('input')
  first.name = 'first_name'
  first.value = 'Dave'
  root.appendChild(first)

  const email = document.createElement('input')
  email.name = 'email'
  email.value = 'dave@example.com'
  root.appendChild(email)

  const phone = document.createElement('input')
  phone.name = 'phone'
  phone.value = '07900000000'
  root.appendChild(phone)

  const phoneCountry = document.createElement('select')
  phoneCountry.name = 'phone_country_code'
  const phoneCountryOption = document.createElement('option')
  phoneCountryOption.value = '+44'
  phoneCountryOption.selected = true
  phoneCountry.appendChild(phoneCountryOption)
  root.appendChild(phoneCountry)

  const asset = document.createElement('select')
  asset.name = 'asset_type'
  const opt = document.createElement('option')
  opt.value = 'Watches'
  opt.selected = true
  asset.appendChild(opt)
  root.appendChild(asset)

  // enquiry_type for success redirect
  const enq = document.createElement('input')
  enq.name = 'enquiry_type'
  enq.value = 'loan'
  root.appendChild(enq)

  document.body.appendChild(root)
  return root
}

describe('attribution capture + expiry + organic inference', () => {
  const originalLocation = window.location
  const originalReferrer = Object.getOwnPropertyDescriptor(Document.prototype, 'referrer')

  beforeEach(() => {
    document.cookie.split(';').forEach((c) => {
      const eq = c.indexOf('=')
      const name = eq > -1 ? c.slice(0, eq).trim() : c.trim()
      if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
    })
    Object.defineProperty(document, 'referrer', { configurable: true, get: () => '' })
  })

  afterEach(() => {
    if (originalReferrer) {
      Object.defineProperty(Document.prototype, 'referrer', originalReferrer)
    }
    // Do not attempt to restore window.location (jsdom does not allow it); tests set search via replaceState where possible
  })

  it('capture writes first landing and UTM from URL, persists to storage', () => {
    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    const url = new URL(window.location.href)
    url.searchParams.set('utm_source', 'google')
    url.searchParams.set('utm_medium', 'cpc')
    url.searchParams.set('utm_campaign', 'brand')
    url.searchParams.set('gclid', 'g123')
    // Use history to influence URLSearchParams read by capture (capture reads window.location.search)
    window.history.replaceState({}, '', url.toString())

    formAttribution.capture()

    const data = JSON.parse(storage.getItem(formConfig.attribution.storageKey) || '{}')
    expect(data.first_landing_url).toBeTruthy()
    expect(data.utm_source).toBe('google')
    expect(data.utm_medium).toBe('cpc')
    expect(data.gclid).toBe('g123')
    expect(typeof data.captured_at).toBe('number')

    formAttribution.getStorage = origGet
  })

  it('capture infers organic google from referrer when no paid/UTM present', () => {
    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    const url = new URL(window.location.href)
    url.search = ''
    window.history.replaceState({}, '', url.toString())

    Object.defineProperty(document, 'referrer', { configurable: true, get: () => 'https://www.google.com/search?q=suttons' })

    formAttribution.capture()

    const data = JSON.parse(storage.getItem(formConfig.attribution.storageKey) || '{}')
    expect(data.utm_source).toBe('google')
    expect(data.utm_medium).toBe('organic')

    formAttribution.getStorage = origGet
  })

  it('capture expires stale attribution after 30 days with no new signals', () => {
    const oldTs = Date.now() - (31 * 24 * 60 * 60 * 1000)
    const storage = makeStorage({
      [formConfig.attribution.storageKey]: JSON.stringify({
        first_landing_url: 'https://example.com/landing',
        first_page: 'https://example.com/landing',
        utm_source: 'google',
        utm_medium: 'cpc',
        captured_at: oldTs,
      }),
    })
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    const url = new URL(window.location.href)
    url.search = ''
    window.history.replaceState({}, '', url.toString())
    Object.defineProperty(document, 'referrer', { configurable: true, get: () => '' })

    formAttribution.capture()

    const data = JSON.parse(storage.getItem(formConfig.attribution.storageKey) || '{}')
    expect(data.utm_source || '').toBe('')
    expect(data.utm_medium || '').toBe('')
    expect(data.gclid || '').toBe('')

    formAttribution.getStorage = origGet
  })

  it('preserves freshly inferred organic attribution even when the stored record is over 30 days old', () => {
    const oldTs = Date.now() - (31 * 24 * 60 * 60 * 1000)
    const storage = makeStorage({
      [formConfig.attribution.storageKey]: JSON.stringify({
        first_landing_url: 'https://example.com/landing',
        first_page: 'https://example.com/landing',
        utm_source: '',
        utm_medium: '',
        captured_at: oldTs,
      }),
    })
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    const url = new URL(window.location.href)
    url.search = ''
    window.history.replaceState({}, '', url.toString())

    Object.defineProperty(document, 'referrer', { configurable: true, get: () => 'https://www.google.com/search?q=suttons' })

    formAttribution.capture()

    const data = JSON.parse(storage.getItem(formConfig.attribution.storageKey) || '{}')
    expect(data.utm_source).toBe('google')
    expect(data.utm_medium).toBe('organic')
    // Timer should have been reset so the fresh inference is not treated as stale
    expect(data.captured_at).toBeGreaterThan(oldTs)

    formAttribution.getStorage = origGet
  })

  // Short reference format: SURNAME-XXXX-XXXX using Crockford base32
  // (no ambiguous I L O U / 0 / 1). No timestamp or counter in the string.
  const SHORT_REF_RE = /^[A-Z]+-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/

  it('getLeadReference produces the short SURNAME-XXXX-XXXX format regardless of storage', () => {
    const root = makeFormFixture()
    const form = { root }
    const id = formAttribution.getLeadReference(form)

    expect(id).not.toMatch(/NaN/)
    expect(id).toMatch(SHORT_REF_RE)
    // No unix timestamp (10 digits) or "-N-" counter segment appears in it.
    expect(id).not.toMatch(/-\d{9,}-/)
    root.remove()
  })

  it('setFields writes the exact client-required hidden fields (unique_id + lead_reference alias)', () => {
    const root = makeFormFixture()
    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    storage.setItem(formConfig.attribution.storageKey, JSON.stringify({
      first_landing_url: 'https://suttons.com/landing',
      first_page: 'https://suttons.com/landing',
      utm_source: 'google',
      utm_medium: 'organic',
      utm_campaign: '',
      utm_term: '',
      utm_content: '',
      gclid: '',
      fbclid: '',
      captured_at: Date.now(),
    }))

    const form = { root, key: 'test' }
    const meta = formAttribution.setFields(form)

    const names = ['unique_id', 'lead_reference', 'first_landing_url', 'GCLID', 'utm_source', 'all_files_url']
    names.forEach((n) => {
      const el = root.querySelector(`[name="${n}"]`)
      expect(el, `missing hidden field ${n}`).toBeTruthy()
    })

    const uid = root.querySelector('[name="unique_id"]').value
    const lref = root.querySelector('[name="lead_reference"]').value
    expect(uid).toBeTruthy()
    expect(lref).toBe(uid)

    const q = root.querySelector('[name="quote_url"]').value
    expect(q).toMatch(/ref=/)
    expect(q).toMatch(/step=2/)
    expect(root.querySelector('[name="all_files_url"]').value).toBe('')

    formAttribution.getStorage = origGet
    root.remove()
  })

  it('setFields always includes all_files_url and preserves the uploaded folder link', () => {
    const root = makeFormFixture()
    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    const form = {
      root,
      key: 'test',
      submissionMeta: {
        folderUrl: 'https://worker.example/folder/TEST-123?s=abc',
      },
    }

    const meta = formAttribution.setFields(form)

    expect(root.querySelector('[name="all_files_url"]').value).toBe('https://worker.example/folder/TEST-123?s=abc')
    expect(meta.folderUrl).toBe('https://worker.example/folder/TEST-123?s=abc')

    formAttribution.getStorage = origGet
    root.remove()
  })

  it('uses the first non-empty explicit brand field for quote_url', () => {
    const root = makeFormFixture()
    const legacyBrand = document.createElement('select')
    legacyBrand.name = 'brand'
    legacyBrand.appendChild(document.createElement('option'))
    root.insertBefore(legacyBrand, root.querySelector('[name="asset_type"]'))

    const watchBrand = document.createElement('select')
    watchBrand.name = 'watch_brand'
    const rolex = document.createElement('option')
    rolex.value = 'Rolex'
    rolex.selected = true
    watchBrand.appendChild(rolex)
    root.insertBefore(watchBrand, root.querySelector('[name="asset_type"]'))

    const quoteUrl = formAttribution.getQuoteUrl({ root }, 'REF-123')
    expect(new URL(quoteUrl).searchParams.get('brand')).toBe('Rolex')

    root.remove()
  })

  it('setFields is idempotent during one active submission', () => {
    const root = makeFormFixture()
    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    const form = { root, key: 'test' }
    const first = formAttribution.setFields(form)
    const second = formAttribution.setFields(form)

    expect(second.uniqueId).toBe(first.uniqueId)
    expect(root.querySelector('[name="unique_id"]').value).toBe(first.uniqueId)
    expect(root.querySelector('[name="lead_reference"]').value).toBe(first.uniqueId)
    expect(root.querySelector('[name="quote_url"]').value).toContain(`ref=${encodeURIComponent(first.uniqueId)}`)

    formAttribution.getStorage = origGet
    root.remove()
  })

  it('does not reuse stale DOM lead references for a new form object', () => {
    const root = makeFormFixture()
    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    const first = formAttribution.setFields({ root, key: 'test' })
    const second = formAttribution.setFields({ root, key: 'test' })

    expect(second.uniqueId).not.toBe(first.uniqueId)
    expect(root.querySelector('[name="unique_id"]').value).toBe(second.uniqueId)
    expect(root.querySelector('[name="lead_reference"]').value).toBe(second.uniqueId)

    formAttribution.getStorage = origGet
    root.remove()
  })

  it('writes attribution before the dev submit event snapshot runs', () => {
    const root = makeFormFixture()
    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage
    storage.setItem(formConfig.attribution.storageKey, JSON.stringify({
      first_landing_url: 'https://suttons.com/landing',
      first_page: 'https://suttons.com/landing',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'brand',
      captured_at: Date.now(),
    }))

    const form = {
      root,
      key: 'test',
      scope: root,
      steps: [],
      stepIndex: 0,
      syncedFieldKeys: new Set(),
    }
    let snapshot = null
    root.addEventListener('suttons:form-submit', () => {
      snapshot = {
        unique_id: root.querySelector('[name="unique_id"]')?.value || '',
        lead_reference: root.querySelector('[name="lead_reference"]')?.value || '',
        utm_source: root.querySelector('[name="utm_source"]')?.value || '',
        current_url: root.querySelector('[name="current_url"]')?.value || '',
        quote_url: root.querySelector('[name="quote_url"]')?.value || '',
      }
    })

    formEvents.handleSubmit(form, {
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    })

    expect(snapshot).toMatchObject({
      utm_source: 'google',
    })
    expect(snapshot.unique_id).toBeTruthy()
    expect(snapshot.lead_reference).toBe(snapshot.unique_id)
    expect(snapshot.current_url).toBeTruthy()
    expect(snapshot.quote_url).toMatch(/ref=/)

    formAttribution.getStorage = origGet
    root.remove()
  })

  it('pushes submitted email and phone to the dataLayer for GTM enhanced conversions', () => {
    const root = makeFormFixture()
    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage
    storage.setItem(formConfig.attribution.storageKey, JSON.stringify({
      first_landing_url: 'https://suttons.com/landing',
      first_page: 'https://suttons.com/landing',
      utm_source: 'google',
      utm_medium: 'cpc',
      captured_at: Date.now(),
    }))

    window.dataLayer = []
    const form = { root, key: 'test' }
    formAttribution.setFields(form)
    formAttribution.pushDataLayer(form)

    expect(window.dataLayer).toContainEqual(expect.objectContaining({
      event: 'form_submission',
      form_name: 'test',
      email: 'dave@example.com',
      phone: '+447900000000',
      unique_id: expect.stringMatching(/^JONES-/),
      utm_source: 'google',
      utm_medium: 'cpc',
    }))

    delete window.dataLayer
    formAttribution.getStorage = origGet
    root.remove()
  })

  it('tags form_category "lead" for real sales forms and "other" for utility forms (GTM trigger source)', () => {
    const root = makeFormFixture()
    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    window.dataLayer = []
    formAttribution.pushDataLayer({ root, key: 'get-a-quote' })
    formAttribution.pushDataLayer({ root, key: 'footer-form' })

    expect(window.dataLayer).toContainEqual(expect.objectContaining({ form_name: 'get-a-quote', form_category: 'lead' }))
    expect(window.dataLayer).toContainEqual(expect.objectContaining({ form_name: 'footer-form', form_category: 'other' }))

    delete window.dataLayer
    formAttribution.getStorage = origGet
    root.remove()
  })

  it('getLeadReference still yields a valid reference when storage is unavailable', () => {
    const throwing = makeStorage({}, true)
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => throwing

    const root = makeFormFixture()
    const form = { root }
    const id = formAttribution.getLeadReference(form)

    // Generation does not touch storage, so a throwing store has no effect.
    expect(id).toMatch(SHORT_REF_RE)

    formAttribution.getStorage = origGet
    root.remove()
  })

  it('getLeadReference generates an unguessable, unique random reference each call', () => {
    const root = makeFormFixture()
    const form = { root }
    const a = formAttribution.getLeadReference(form)
    const b = formAttribution.getLeadReference(form)

    expect(a).toMatch(SHORT_REF_RE)
    expect(b).toMatch(SHORT_REF_RE)
    // The two random blocks differ, so two enquiries can't collide on a folder.
    expect(a).not.toBe(b)
  })

  it('falls back to "SR" (no leading dash) when the surname strips to empty', () => {
    const root = makeFormFixture()
    root.querySelector('[name="last_name"]').value = '王' // non-Latin -> strips to ''
    const id = formAttribution.getLeadReference({ root })
    expect(id.startsWith('SR-')).toBe(true)
    expect(id).toMatch(SHORT_REF_RE)
    root.remove()
  })

  it('caps a very long surname so the reference stays phone-short', () => {
    const root = makeFormFixture()
    root.querySelector('[name="last_name"]').value = 'A'.repeat(60)
    const id = formAttribution.getLeadReference({ root })
    expect(id.split('-')[0].length).toBeLessThanOrEqual(20)
    expect(id).toMatch(SHORT_REF_RE)
    root.remove()
  })

  it('never emits ambiguous characters (I, L, O, U) in the random blocks', () => {
    const root = makeFormFixture()
    for (let i = 0; i < 500; i += 1) {
      const blocks = formAttribution.getLeadReference({ root }).split('-').slice(1).join('')
      expect(blocks).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
      expect(blocks).not.toMatch(/[ILOU]/)
    }
    root.remove()
  })

  it('generates unique, well-formed references across 1000 calls', () => {
    const root = makeFormFixture()
    const seen = new Set()
    for (let i = 0; i < 1000; i += 1) {
      const id = formAttribution.getLeadReference({ root })
      expect(id).toMatch(SHORT_REF_RE)
      seen.add(id)
    }
    expect(seen.size).toBe(1000)
    root.remove()
  })
})

// Consent Pro (consentpro.com) blocks tracking resources by category, and
// exposes no consent flag to read. `capture()` / `pushDataLayer()` always run;
// the tags they feed are gated by Consent Pro. See conditions.js.

describe('phone autocomplete normalization', () => {
  function makePhoneForm(phoneValue, countryValue = '+44', countryOptions = null) {
    const root = document.createElement('form')
    root.setAttribute('data-form', 'test')

    const country = countryOptions ? document.createElement('select') : document.createElement('input')
    country.name = 'phone_country_code'
    if (countryOptions) {
      countryOptions.forEach((value) => {
        const option = document.createElement('option')
        option.value = value
        option.textContent = value
        country.appendChild(option)
      })
    }
    country.value = countryValue
    root.appendChild(country)

    const phone = document.createElement('input')
    phone.name = 'phone'
    phone.type = 'tel'
    phone.value = phoneValue
    root.appendChild(phone)

    document.body.appendChild(root)
    return { root, country, phone }
  }

  it('strips a manually typed leading-zero UK number when a country code is selected', () => {
    const { root, phone } = makePhoneForm('07900 000000')

    expect(formFields.normalizePhoneValue(phone)).toBe('7900000000')
    formFields.filterInput(phone)
    expect(phone.value).toBe('7900000000')
    expect(formAttribution.getPhoneValue({ root, key: 'test' })).toBe('+447900000000')

    root.remove()
  })

  it('does not duplicate +44 when autocomplete supplies a full international value', () => {
    const { root, phone } = makePhoneForm('+44 7900 000000')

    expect(formFields.normalizePhoneValue(phone)).toBe('7900000000')
    formFields.filterInput(phone)
    expect(phone.value).toBe('7900000000')
    expect(formAttribution.getPhoneValue({ root, key: 'test' })).toBe('+447900000000')

    root.remove()
  })

  it('strips the selected prefix from the visible browser-autofilled phone field', () => {
    const { root, phone } = makePhoneForm('+447926879914')

    formFields.filterInput(phone)

    expect(phone.value).toBe('7926879914')
    expect(formAttribution.getPhoneValue({ root, key: 'test' })).toBe('+447926879914')

    root.remove()
  })

  it('updates a mismatched country code when autocomplete supplies a UK international value', () => {
    const { root, country, phone } = makePhoneForm('+447926879914', '+64')

    formFields.filterInput(phone)

    expect(country.value).toBe('+44')
    expect(phone.value).toBe('7926879914')
    expect(formAttribution.getPhoneValue({ root, key: 'test' })).toBe('+447926879914')

    root.remove()
  })

  it('updates country code and visible number for international autocomplete values', () => {
    const options = ['+1', '+33', '+44', '+61', '+64', '+971']
    const cases = [
      { raw: '+64 21 123 4567', selected: '+44', country: '+64', visible: '211234567', final: '+64211234567' },
      { raw: '+61 412 345 678', selected: '+64', country: '+61', visible: '412345678', final: '+61412345678' },
      { raw: '+33 6 12 34 56 78', selected: '+44', country: '+33', visible: '612345678', final: '+33612345678' },
      { raw: '+1 415 555 0132', selected: '+44', country: '+1', visible: '4155550132', final: '+14155550132' },
      { raw: '+971 50 123 4567', selected: '+44', country: '+971', visible: '501234567', final: '+971501234567' },
    ]

    cases.forEach(({ raw, selected, country: expectedCountry, visible, final }) => {
      const { root, country, phone } = makePhoneForm(raw, selected, options)

      formFields.filterInput(phone)

      expect(country.value).toBe(expectedCountry)
      expect(phone.value).toBe(visible)
      expect(formAttribution.getPhoneValue({ root, key: 'test' })).toBe(final)

      root.remove()
    })
  })

  it('does not assign an unavailable fallback country code to native country selects', () => {
    const { root, country, phone } = makePhoneForm('+44 7926 879914', '+64', ['+64', '+61'])

    formFields.filterInput(phone)

    expect(country.value).toBe('+64')
    expect(phone.value).toBe('+447926879914')
    expect(formAttribution.getPhoneValue({ root, key: 'test' })).toBe('+447926879914')

    root.remove()
  })

  it('does not duplicate the selected country code when autocomplete omits the plus', () => {
    const { root, phone } = makePhoneForm('447900000000')

    expect(formFields.normalizePhoneValue(phone)).toBe('7900000000')
    expect(formAttribution.getPhoneValue({ root, key: 'test' })).toBe('+447900000000')

    root.remove()
  })
})

describe('redirect form attribution carry + Reference on TY', () => {
  it('redirect submit carries attribution + lead_reference/ref into target URL (no navigation)', () => {
    const root = document.createElement('form')
    root.setAttribute('data-form', 'home')
    root.setAttribute('data-form-mode', 'redirect')
    root.setAttribute('data-form-redirect-url', '/get-a-quote')
    root.setAttribute('data-form-redirect-form', 'get-a-quote')

    const ln = document.createElement('input')
    ln.name = 'last_name'
    ln.value = 'Smith'
    root.appendChild(ln)

    document.body.appendChild(root)

    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage
    storage.setItem(formConfig.attribution.storageKey, JSON.stringify({
      first_landing_url: 'https://suttons.com/?utm_source=google&utm_medium=cpc',
      first_page: 'https://suttons.com/',
      utm_source: 'google',
      utm_medium: 'cpc',
      gclid: 'g-from-ad',
      captured_at: Date.now(),
    }))

    const form = { root, key: 'home' }
    const values = formRedirect.getRedirectValues(form)

    // Call the pure URL computer (avoids jsdom navigation). submit() uses this internally.
    const meta = formAttribution.setFields(form) // also ensures unique_id/lead_reference exist
    const targetHref = formRedirect.computeTargetUrl(form, values, meta)

    formAttribution.getStorage = origGet
    root.remove()

    expect(targetHref).toBeTruthy()
    const u = new URL(targetHref, 'http://localhost/')
    // formParams.getParamName keys redirect forms by data-form-redirect-form,
    // so values may appear bare or under that prefix.
    const allParams = Array.from(u.searchParams.entries()).map(([k, v]) => `${k}=${v}`).join('&')
    expect(allParams).toMatch(/utm_source=google/)
    expect(allParams).toMatch(/GCLID=g-from-ad/)
    // lead_reference / ref / unique_id must be present for TY tracking
    expect(allParams).toMatch(/ref=/)
    expect(allParams).toMatch(/lead_reference=/)
  })

  it('includes non-tracking hidden fields in redirect URLs', () => {
    const root = document.createElement('form')
    root.setAttribute('data-form', 'loan')
    root.setAttribute('data-form-mode', 'redirect')
    root.setAttribute('data-form-redirect-url', '/get-a-quote')
    root.setAttribute('data-form-redirect-form', 'get-a-quote')
    root.innerHTML = `
      <input type="hidden" name="requested_amount" value="5000">
      <input type="hidden" name="loan_duration_months" value="6">
      <input type="hidden" name="unique_id" value="TRACKING-SHOULD-STAY-EXCLUDED">
    `

    const values = formRedirect.getRedirectValues({ root, key: 'loan' })

    expect(values).toEqual(expect.arrayContaining([
      { name: 'requested_amount', values: ['5000'] },
      { name: 'loan_duration_months', values: ['6'] },
    ]))
    expect(values.some((entry) => entry.name === 'unique_id')).toBe(false)
  })

  it('keeps redirect URL reference consistent across repeated setFields calls on the same form object', () => {
    const root = document.createElement('form')
    root.setAttribute('data-form', 'home')
    root.setAttribute('data-form-mode', 'redirect')
    root.setAttribute('data-form-redirect-url', '/get-a-quote')
    root.setAttribute('data-form-redirect-form', 'get-a-quote')

    const ln = document.createElement('input')
    ln.name = 'last_name'
    ln.value = 'Smith'
    root.appendChild(ln)
    document.body.appendChild(root)

    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    const form = { root, key: 'home' }
    const meta = formAttribution.setFields(form)
    formAttribution.setFields(form)
    const targetHref = formRedirect.computeTargetUrl(form, formRedirect.getRedirectValues(form), meta)
    const url = new URL(targetHref, 'http://localhost/')

    expect(url.searchParams.get('get-a-quote.ref')).toBe(meta.uniqueId)
    expect(url.searchParams.get('get-a-quote.lead_reference')).toBe(meta.uniqueId)
    expect(root.querySelector('[name="unique_id"]').value).toBe(meta.uniqueId)

    formAttribution.getStorage = origGet
    root.remove()
  })
})

describe('cookie fallback resilience', () => {
  it('readAttribution falls back to cookie when storage is empty/corrupt', () => {
    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    const payload = {
      first_landing_url: 'https://suttons.com/landing',
      utm_source: 'bing',
      utm_medium: 'organic',
      captured_at: Date.now(),
    }
    document.cookie = `sr_attribution=${encodeURIComponent(JSON.stringify(payload))};path=/`

    const read = formAttribution.readAttribution(storage)
    expect(read.utm_source).toBe('bing')
    expect(read.first_landing_url).toContain('landing')

    formAttribution.getStorage = origGet
  })

  it('writeAttribution mirrors to cookie even if storage write fails', () => {
    const throwing = makeStorage({}, true)
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => throwing

    const ok = formAttribution.writeAttribution(throwing, {
      first_landing_url: 'https://x',
      utm_source: 'duckduckgo',
      utm_medium: 'organic',
      captured_at: Date.now(),
    })
    expect(ok).toBe(false)

    const c = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('sr_attribution='))
    expect(c).toBeTruthy()
    const decoded = JSON.parse(decodeURIComponent(c.split('=')[1]))
    expect(decoded.utm_source).toBe('duckduckgo')

    formAttribution.getStorage = origGet
  })
})

// WhatsApp and email links: trailing text stays out of the value. A greeting
// pulled into the URL can produce UTM values like `direct Hello` or
// `whatsapp\nHello`. A valid UTM value has no whitespace, so each collapses to
// its first token at capture/read, before it reaches hidden fields, dataLayer,
// redirect params or the WhatsApp link.
describe('UTM sanitization (whitespace)', () => {
  const cases = [
    ['space (direct+Hello decodes to a space)', 'direct Hello', 'direct'],
    ['newline (whatsapp%0AHello)', 'whatsapp\nHello', 'whatsapp'],
    ['tab', 'cpc\tHello', 'cpc'],
    ['CRLF', 'email\r\nHello there', 'email'],
    ['leading whitespace', '   google', 'google'],
  ]

  it('sanitizeUtmValue collapses corrupted values to the first token', () => {
    cases.forEach(([label, input, expected]) => {
      expect(formAttribution.sanitizeUtmValue(input), label).toBe(expected)
    })
    // Nullish coerces to empty string, never "null"/"undefined".
    expect(formAttribution.sanitizeUtmValue(null)).toBe('')
    expect(formAttribution.sanitizeUtmValue(undefined)).toBe('')
  })

  it('leaves a legitimate UTM value untouched', () => {
    expect(formAttribution.sanitizeUtmValue('summer_sale-2026')).toBe('summer_sale-2026')
  })

  it('capture() sanitizes a corrupted inbound URL param before persisting', () => {
    const storage = makeStorage()
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    const url = new URL(window.location.href)
    url.search = ''
    // A greeting carried into the query string by a WhatsApp link.
    url.searchParams.set('utm_source', 'whatsapp')
    url.searchParams.set('utm_medium', 'whatsapp\nHello')
    url.searchParams.set('utm_campaign', 'summer_sale-2026')
    window.history.replaceState({}, '', url.toString())

    formAttribution.capture()

    const data = JSON.parse(storage.getItem(formConfig.attribution.storageKey) || '{}')
    expect(data.utm_medium).toBe('whatsapp')
    expect(data.utm_campaign).toBe('summer_sale-2026')

    formAttribution.getStorage = origGet
  })

  it('readAttribution defensively cleans an already-corrupted stored value', () => {
    const storage = makeStorage({
      [formConfig.attribution.storageKey]: JSON.stringify({
        first_landing_url: 'https://suttons.com/landing',
        utm_source: 'direct Hello',
        utm_medium: 'whatsapp\nHello',
        utm_campaign: 'summer_sale-2026',
        captured_at: Date.now(),
      }),
    })
    const clean = formAttribution.readAttribution(storage)
    expect(clean.utm_source).toBe('direct')
    expect(clean.utm_medium).toBe('whatsapp')
    expect(clean.utm_campaign).toBe('summer_sale-2026')
  })

  it('setFields writes the sanitized value into the hidden field', () => {
    const root = makeFormFixture()
    const storage = makeStorage({
      [formConfig.attribution.storageKey]: JSON.stringify({
        first_landing_url: 'https://suttons.com/landing',
        first_page: 'https://suttons.com/landing',
        utm_source: 'whatsapp',
        utm_medium: 'whatsapp\nHello',
        utm_campaign: 'summer_sale-2026',
        captured_at: Date.now(),
      }),
    })
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    formAttribution.setFields({ root, key: 'test' })
    expect(root.querySelector('[name="utm_medium"]').value).toBe('whatsapp')
    expect(root.querySelector('[name="utm_campaign"]').value).toBe('summer_sale-2026')

    formAttribution.getStorage = origGet
    root.remove()
  })

  it('pushDataLayer emits the sanitized value', () => {
    const root = makeFormFixture()
    const storage = makeStorage({
      [formConfig.attribution.storageKey]: JSON.stringify({
        first_landing_url: 'https://suttons.com/landing',
        utm_source: 'whatsapp',
        utm_medium: 'whatsapp\nHello',
        utm_campaign: 'summer_sale-2026',
        captured_at: Date.now(),
      }),
    })
    const origGet = formAttribution.getStorage
    formAttribution.getStorage = () => storage

    window.dataLayer = []
    formAttribution.pushDataLayer({ root, key: 'test' })

    const evt = window.dataLayer.find((e) => e.event === 'form_submission')
    expect(evt).toBeTruthy()
    expect(evt.utm_medium).toBe('whatsapp')
    expect(evt.utm_campaign).toBe('summer_sale-2026')

    formAttribution.getStorage = origGet
    delete window.dataLayer
    root.remove()
  })
})

// Cookies are Secure; the success snapshot keeps only fields a thank-you page
// needs, is cleared by trackSuccess (not hydrateOutputs) after use, and
// expires via a savedAt TTL.
describe('personal data and cookies', () => {
  function withCookieSpy(fn) {
    const writes = []
    const orig = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() { return orig.get.call(document) },
      set(v) { writes.push(v); orig.set.call(document, v) },
    })
    try {
      fn(writes)
    } finally {
      Object.defineProperty(document, 'cookie', orig)
    }
  }

  it('writeCookie adds Secure alongside SameSite=Lax and path=/', () => {
    withCookieSpy((writes) => {
      formAttribution.writeAttribution(makeStorage(), {
        first_landing_url: 'https://x',
        utm_source: 'google',
        captured_at: Date.now(),
      })
      const cookieWrite = writes.find((w) => w.startsWith('sr_attribution='))
      expect(cookieWrite).toBeTruthy()
      expect(cookieWrite).toContain(';Secure')
      expect(cookieWrite).toContain('SameSite=Lax')
      expect(cookieWrite).toContain('path=/')
    })
  })

  it('snapshot keeps rendered fields + email/phone (for the TY push) and drops other PII', () => {
    window.sessionStorage.clear()
    const root = makeFormFixture() // includes email + phone + enquiry_type=loan + asset_type=Watches

    const compact = formAttribution.storeSuccessSnapshot({ root, key: 'enquiry' }, { uniqueId: 'SR-100' })

    expect(compact.reference).toBe('SR-100')
    expect(compact.enquiry_type).toBe('loan')
    expect(compact.asset_type).toBe('Watches')
    expect(typeof compact.savedAt).toBe('number')
    // email/phone are kept: the thank-you page form_submission push needs them.
    expect(compact.email).toBe('dave@example.com')
    expect(compact.phone).toBe('+447900000000')
    // Other personal data must be absent.
    expect(compact.appointment_date).toBeUndefined()
    expect(compact.requested_amount).toBeUndefined()
    expect(compact.contact_method).toBeUndefined()

    const stored = JSON.parse(window.sessionStorage.getItem('sr_form_success_SR-100'))
    expect(stored.email).toBe('dave@example.com')
    expect(stored.reference).toBe('SR-100')

    root.remove()
  })

  it('hydrateOutputs renders reference/enquiry_type but NOT email/phone, and does not clear', () => {
    window.sessionStorage.clear()
    window.sessionStorage.setItem('sr_form_success_SR-200', JSON.stringify({
      reference: 'SR-200', form: 'enquiry', enquiry_type: 'loan',
      email: 'dave@example.com', phone: '+447900000000', savedAt: Date.now(),
    }))
    window.sessionStorage.setItem('sr_form_success_latest', JSON.stringify({
      reference: 'SR-200', form: 'enquiry', savedAt: Date.now(),
    }))

    const url = new URL(window.location.href)
    url.search = '?form=enquiry&Reference=SR-200'
    window.history.replaceState({}, '', url.toString())

    const scope = document.createElement('div')
    const refOut = document.createElement('span')
    refOut.setAttribute('data-form-success-output', 'reference')
    const emailOut = document.createElement('span')
    emailOut.setAttribute('data-form-success-output', 'email')
    scope.appendChild(refOut)
    scope.appendChild(emailOut)
    document.body.appendChild(scope)

    formSuccessPage.hydrateOutputs(scope)

    expect(refOut.textContent).toBe('SR-200')
    // email is retained in the snapshot but NOT surfaced by getSuccessData → not rendered.
    expect(emailOut.textContent).toBe('')
    // hydrateOutputs does not clear; trackSuccess clears after the push.
    expect(window.sessionStorage.getItem('sr_form_success_SR-200')).not.toBeNull()

    scope.remove()
  })

  it('readStoredSnapshot ignores and removes an expired (old savedAt) snapshot', () => {
    window.sessionStorage.clear()
    const expired = Date.now() - (31 * 60 * 1000) // 31 min ago, past the 30-min TTL
    window.sessionStorage.setItem('sr_form_success_SR-300', JSON.stringify({
      reference: 'SR-300', enquiry_type: 'sell', savedAt: expired,
    }))

    const result = formSuccessPage.readStoredSnapshot('SR-300')
    expect(result).toEqual({})
    expect(window.sessionStorage.getItem('sr_form_success_SR-300')).toBeNull()
  })

  it('readStoredSnapshot returns a fresh (recent savedAt) snapshot', () => {
    window.sessionStorage.clear()
    window.sessionStorage.setItem('sr_form_success_SR-400', JSON.stringify({
      reference: 'SR-400', enquiry_type: 'sell', savedAt: Date.now(),
    }))
    const result = formSuccessPage.readStoredSnapshot('SR-400')
    expect(result.reference).toBe('SR-400')
    expect(result.enquiry_type).toBe('sell')
  })
})

// form_submission fires on the thank-you page from the stored snapshot, so a
// native form POST that navigates away early still reports the conversion.
describe('thank-you page form_submission push (formSuccessPage.trackSuccess)', () => {
  let attrStorage
  let origGetStorage

  function seedAttribution() {
    attrStorage.setItem(formConfig.attribution.storageKey, JSON.stringify({
      utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'gold',
      utm_term: 'sell-gold', utm_content: 'hero', gclid: 'G123', fbclid: 'F456',
      captured_at: Date.now(),
    }))
  }

  function seedSnapshot(ref = 'SR-900') {
    window.sessionStorage.setItem(`sr_form_success_${ref}`, JSON.stringify({
      reference: ref, form: 'get-a-quote', enquiry_type: 'sell', asset_type: 'Watches',
      email: 'dave@example.com', phone: '+447900000000', savedAt: Date.now(),
    }))
  }

  function setTyUrl(ref = 'SR-900') {
    const url = new URL(window.location.href)
    url.search = `?form=get-a-quote&Reference=${ref}`
    window.history.replaceState({}, '', url.toString())
  }

  beforeEach(() => {
    window.sessionStorage.clear()
    attrStorage = makeStorage()
    origGetStorage = formAttribution.getStorage
    formAttribution.getStorage = () => attrStorage
    // Reset the module-level dedup state between tests.
    formSuccessPage.pushedReferences.clear()
    formSuccessPage.hasPushedNoRef = false
    window.dataLayer = []
  })

  afterEach(() => {
    formAttribution.getStorage = origGetStorage
    delete window.dataLayer
  })

  it('pushes form_submission with the full payload (email/phone/reference/form_category/utm)', () => {
    seedAttribution()
    seedSnapshot()
    setTyUrl()

    formSuccessPage.trackSuccess(document)

    expect(window.dataLayer).toContainEqual(expect.objectContaining({
      event: 'form_submission',
      form_name: 'get-a-quote',
      form_category: 'lead', // get-a-quote is a lead form key
      form_status: 'success',
      unique_id: 'SR-900',
      email: 'dave@example.com',
      phone: '+447900000000',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'gold',
      utm_term: 'sell-gold',
      utm_content: 'hero',
      GCLID: 'G123',
      fbclid: 'F456',
    }))
  })

  it('clears the snapshot only AFTER the push has fired', () => {
    seedAttribution()
    seedSnapshot()
    setTyUrl()

    expect(window.sessionStorage.getItem('sr_form_success_SR-900')).not.toBeNull()
    formSuccessPage.trackSuccess(document)

    expect(window.dataLayer.find((e) => e.event === 'form_submission')).toBeTruthy()
    expect(window.sessionStorage.getItem('sr_form_success_SR-900')).toBeNull()
  })

  it('does not push when there is no snapshot', () => {
    seedAttribution()
    setTyUrl() // TY URL present but no stored snapshot

    formSuccessPage.trackSuccess(document)

    expect(window.dataLayer).toHaveLength(0)
  })

  it('double-init pushes only once (dedup by reference)', () => {
    seedAttribution()
    seedSnapshot()
    setTyUrl()

    formSuccessPage.trackSuccess(document)
    // Re-seed the snapshot to prove the dedup guard (not just the clear) blocks the 2nd push.
    seedSnapshot()
    formSuccessPage.trackSuccess(document)

    const pushes = window.dataLayer.filter((e) => e.event === 'form_submission')
    expect(pushes).toHaveLength(1)
  })
})
