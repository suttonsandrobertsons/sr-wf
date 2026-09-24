import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formUploads, formDom } from '../core.js'

// Builds an upload widget with the primary (image) value field and, optionally,
// a dedicated file value field for documents/videos.
function buildUpload({ withFileField = true, required = false } = {}) {
  document.body.innerHTML = `
    <form data-form="quote">
      <div data-form-upload ${required ? 'data-form-field-required="true"' : ''}>
        <input type="hidden" name="item_image" data-form-upload-value>
        ${withFileField ? '<input type="hidden" name="item_file" data-form-upload-value-file>' : ''}
        <div class="form_upload-name"></div>
        <div data-form-error></div>
      </div>
    </form>`
  return document.querySelector('[data-form-upload]')
}

const uploadName = (u) => u.querySelector('.form_upload-name')

const imageField = (u) => u.querySelector('[data-form-upload-value]')
const fileField = (u) => u.querySelector('[data-form-upload-value-file]')

describe('upload value routing by category', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('routes images to the primary value field and clears the file field', () => {
    const upload = buildUpload()
    formUploads.routeUploadValue(upload, imageField(upload), 'image', 'https://x/a.jpg')
    expect(imageField(upload).value).toBe('https://x/a.jpg')
    expect(fileField(upload).value).toBe('')
  })

  it('routes documents/videos to the file field and clears the image field', () => {
    const upload = buildUpload()
    formUploads.routeUploadValue(upload, imageField(upload), 'file', 'https://x/a.pdf')
    expect(fileField(upload).value).toBe('https://x/a.pdf')
    expect(imageField(upload).value).toBe('')
  })

  it('re-selecting a different type clears the previously populated field', () => {
    const upload = buildUpload()
    formUploads.routeUploadValue(upload, imageField(upload), 'image', 'https://x/a.jpg')
    formUploads.routeUploadValue(upload, imageField(upload), 'file', 'https://x/a.mov')
    expect(imageField(upload).value).toBe('')
    expect(fileField(upload).value).toBe('https://x/a.mov')
  })

  it('falls back to the primary field when no file target exists', () => {
    const upload = buildUpload({ withFileField: false })
    formUploads.routeUploadValue(upload, imageField(upload), 'file', 'https://x/a.pdf')
    expect(imageField(upload).value).toBe('https://x/a.pdf')
  })

  it('treats a required upload as satisfied by EITHER target', () => {
    const upload = buildUpload({ required: true })
    expect(formUploads.validate(upload)).toBe(false)

    formUploads.routeUploadValue(upload, imageField(upload), 'file', 'https://x/a.pdf')
    expect(formUploads.validate(upload)).toBe(true)

    formUploads.clear(upload)
    expect(formUploads.validate(upload)).toBe(false)

    formUploads.routeUploadValue(upload, imageField(upload), 'image', 'https://x/a.jpg')
    expect(formUploads.validate(upload)).toBe(true)
  })

  it('supports the explicit data-form-upload-value-image attribute', () => {
    document.body.innerHTML = `
      <form data-form="quote">
        <div data-form-upload data-form-field-required="true">
          <input type="hidden" name="item_image" data-form-upload-value-image>
          <input type="hidden" name="item_file" data-form-upload-value-file>
          <div data-form-error></div>
        </div>
      </form>`
    const upload = document.querySelector('[data-form-upload]')
    const img = upload.querySelector('[data-form-upload-value-image]')
    formUploads.routeUploadValue(upload, img, 'image', 'https://x/a.jpg')
    expect(img.value).toBe('https://x/a.jpg')
    expect(formUploads.validate(upload)).toBe(true)
  })

  it('maps worker error codes to human-readable messages (never raw codes)', () => {
    expect(formUploads.friendlyUploadError('conversion_failed')).not.toContain('conversion_failed')
    expect(formUploads.friendlyUploadError('conversion_failed').toLowerCase()).toContain('process')
    expect(formUploads.friendlyUploadError('file_type_not_allowed').toLowerCase()).toContain('supported')
    expect(formUploads.friendlyUploadError('network_error').toLowerCase()).toContain('connection')
    // unknown / unmapped codes still get a friendly fallback, not the raw code
    expect(formUploads.friendlyUploadError('http_500')).toBe('Upload failed. Please try again.')
    expect(formUploads.friendlyUploadError(undefined)).toBe('Upload failed. Please try again.')
  })

  it('clear() empties both value targets', () => {
    const upload = buildUpload()
    formUploads.routeUploadValue(upload, imageField(upload), 'file', 'https://x/a.pdf')
    formUploads.clear(upload)
    expect(imageField(upload).value).toBe('')
    expect(fileField(upload).value).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Upload lifecycle: loading gate, A-then-B race, parse/empty success handling
// ---------------------------------------------------------------------------

// Minimal XMLHttpRequest stand-in. postFile uses XHR (not fetch) for
// xhr.upload.onprogress. Instances are captured so a test can drive progress,
// completion, timeout and abort; set MockXHR.onSend to respond synchronously.
class MockXHR {
  constructor() {
    this.upload = {}
    this.status = 0
    this.statusText = ''
    this.responseText = ''
    this.timeout = 0
    this.aborted = false
    MockXHR.instances.push(this)
  }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(key, value) { (this.headers ||= {})[key] = value }
  send(body) {
    this.body = body
    if (MockXHR.onSend) MockXHR.onSend(this)
  }
  abort() {
    this.aborted = true
    if (this.onabort) this.onabort()
  }
  // --- test drivers ---
  emitProgress(loaded, total, lengthComputable = true) {
    if (this.upload.onprogress) this.upload.onprogress({ loaded, total, lengthComputable })
  }
  respond({ status = 200, body } = {}) {
    this.status = status
    this.statusText = status >= 200 && status < 300 ? 'OK' : 'Error'
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body)
    if (this.onload) this.onload()
  }
  respondRaw({ status = 200, responseText = '' } = {}) {
    this.status = status
    this.statusText = status >= 200 && status < 300 ? 'OK' : 'Error'
    this.responseText = responseText
    if (this.onload) this.onload()
  }
  fireTimeout() { if (this.ontimeout) this.ontimeout() }
  fireError() { if (this.onerror) this.onerror() }
}
MockXHR.instances = []
MockXHR.onSend = null

function installMockXHR() {
  MockXHR.instances = []
  MockXHR.onSend = null
  vi.stubGlobal('XMLHttpRequest', MockXHR)
}

const imageFile = (name = 'watch.jpg') => new File(['img-bytes'], name, { type: 'image/jpeg' })
const videoFile = (name = 'clip.mov') => new File(['x'.repeat(64)], name, { type: 'video/quicktime' })
const form = () => ({ root: document.querySelector('form') })

describe('upload lifecycle: loading gate', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('blocks a required upload that is still loading with a wait message (not the required message)', () => {
    const upload = buildUpload({ required: true })
    formDom.setState(upload, 'loading', true)

    expect(formUploads.validate(upload)).toBe(false)
    expect(upload.querySelector('[data-form-error]').textContent).toBe('Please wait for uploads to finish.')
  })

  it('blocks an OPTIONAL upload that has a file still loading (must not submit an empty URL)', () => {
    const upload = buildUpload({ required: false })
    formDom.setState(upload, 'loading', true)

    expect(formUploads.validate(upload)).toBe(false)
    expect(upload.querySelector('[data-form-error]').textContent).toBe('Please wait for uploads to finish.')
  })

  it('passes an OPTIONAL upload with no file selected and nothing loading', () => {
    const upload = buildUpload({ required: false })
    expect(formUploads.validate(upload)).toBe(true)
  })
})

describe('upload lifecycle: progress label', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    installMockXHR()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('updates the loading label with a live percentage as bytes upload', async () => {
    const upload = buildUpload()
    const p = formUploads.handle(form(), upload, videoFile('clip.mov'))
    const xhr = MockXHR.instances[0]

    // Immediately after setLoading, before any progress event fires.
    expect(uploadName(upload).textContent).toBe('Uploading clip.mov...')

    xhr.emitProgress(5, 20) // 25%
    expect(uploadName(upload).textContent).toContain('25%')
    expect(uploadName(upload).textContent).toContain('clip.mov')

    xhr.emitProgress(20, 20) // 100%
    expect(uploadName(upload).textContent).toContain('100%')

    // Non-computable progress must not corrupt the label with NaN%.
    xhr.emitProgress(0, 0, false)
    expect(uploadName(upload).textContent).not.toContain('NaN')

    xhr.respond({ status: 200, body: { url: 'https://x/clip.mov', category: 'file' } })
    await p
    expect(uploadName(upload).textContent).toBe('clip.mov')
  })

  it('ignores progress from a superseded (stale-token) upload', async () => {
    const upload = buildUpload()

    const pA = formUploads.handle(form(), upload, imageFile('A.jpg'))
    const pB = formUploads.handle(form(), upload, imageFile('B.jpg'))
    const xhrA = MockXHR.instances[0]
    const xhrB = MockXHR.instances[1]

    // A is now stale (B bumped the token). A late progress event from A must not
    // touch the label, which belongs to B.
    xhrA.emitProgress(1, 20)
    expect(uploadName(upload).textContent).toBe('Uploading B.jpg...')

    xhrB.emitProgress(10, 20) // 50%
    expect(uploadName(upload).textContent).toContain('50%')

    xhrB.respond({ status: 200, body: { url: 'https://x/B.jpg', category: 'image' } })
    await pB
    xhrA.respond({ status: 200, body: { url: 'https://x/A.jpg', category: 'image' } })
    await pA
    expect(imageField(upload).value).toBe('https://x/B.jpg')
  })
})

describe('upload lifecycle: request supersession (A-then-B)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    installMockXHR()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ignores a late file-A completion so file-B\'s URL wins', async () => {
    const upload = buildUpload()

    const pA = formUploads.handle(form(), upload, imageFile('A.jpg'))
    const pB = formUploads.handle(form(), upload, imageFile('B.jpg'))
    expect(MockXHR.instances.length).toBe(2)

    MockXHR.instances[1].respond({ status: 200, body: { url: 'https://x/B.jpg', category: 'image' } })
    await pB
    expect(imageField(upload).value).toBe('https://x/B.jpg')

    // A resolves late (slow) — its stale result must be ignored, not overwrite B.
    MockXHR.instances[0].respond({ status: 200, body: { url: 'https://x/A.jpg', category: 'image' } })
    await pA
    expect(imageField(upload).value).toBe('https://x/B.jpg')
    expect(upload.getAttribute('data-form-state')).toContain('uploaded')
  })

  it('aborts the prior in-flight request when a newer file is selected', async () => {
    const upload = buildUpload()

    const pA = formUploads.handle(form(), upload, imageFile('A.jpg'))
    const xhrA = MockXHR.instances[0]
    const pB = formUploads.handle(form(), upload, imageFile('B.jpg'))

    expect(xhrA.aborted).toBe(true)

    MockXHR.instances[1].respond({ status: 200, body: { url: 'https://x/B.jpg', category: 'image' } })
    await pB
    await pA // A's abort resolves silently (stale/AbortError), no state change
    expect(imageField(upload).value).toBe('https://x/B.jpg')
    expect(upload.getAttribute('data-form-state')).toContain('uploaded')
  })
})

describe('upload lifecycle: success validation (parse failure / empty URL / timeout)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    installMockXHR()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats a 200 with unparseable body as an error, not success, and writes no URL', async () => {
    MockXHR.onSend = (xhr) => xhr.respondRaw({ status: 200, responseText: '<<not json>>' })
    const upload = buildUpload()

    await formUploads.handle(form(), upload, imageFile())

    expect(upload.getAttribute('data-form-state')).toContain('invalid')
    expect(upload.getAttribute('data-form-state') || '').not.toContain('uploaded')
    expect(imageField(upload).value).toBe('')
    expect(fileField(upload).value).toBe('')
    expect(upload.querySelector('[data-form-error]').textContent).not.toBe('')
  })

  it('treats a 200 with no usable URL as an error, not success', async () => {
    MockXHR.onSend = (xhr) => xhr.respond({ status: 200, body: { category: 'image' } })
    const upload = buildUpload()

    await formUploads.handle(form(), upload, imageFile())

    expect(upload.getAttribute('data-form-state')).toContain('invalid')
    expect(upload.getAttribute('data-form-state') || '').not.toContain('uploaded')
    expect(imageField(upload).value).toBe('')
  })

  it('writes the URL and marks uploaded on a valid 200 response', async () => {
    MockXHR.onSend = (xhr) => xhr.respond({ status: 200, body: { url: 'https://x/ok.jpg', category: 'image' } })
    const upload = buildUpload()

    await formUploads.handle(form(), upload, imageFile())

    expect(imageField(upload).value).toBe('https://x/ok.jpg')
    expect(upload.getAttribute('data-form-state')).toContain('uploaded')
  })

  it('maps a non-2xx worker code to a friendly error (surfaces file_content_mismatch)', async () => {
    MockXHR.onSend = (xhr) => xhr.respond({ status: 400, body: { error: 'file_content_mismatch' } })
    const upload = buildUpload()

    await formUploads.handle(form(), upload, imageFile())

    expect(upload.getAttribute('data-form-state')).toContain('invalid')
    const msg = upload.querySelector('[data-form-error]').textContent
    expect(msg).not.toContain('file_content_mismatch')
    expect(msg.toLowerCase()).toContain('valid image')
  })

  it('treats a timeout as an error with the friendly timeout message', async () => {
    MockXHR.onSend = (xhr) => xhr.fireTimeout()
    const upload = buildUpload()

    await formUploads.handle(form(), upload, imageFile())

    expect(upload.getAttribute('data-form-state')).toContain('invalid')
    expect(upload.getAttribute('data-form-state') || '').not.toContain('uploaded')
    expect(imageField(upload).value).toBe('')
    expect(upload.querySelector('[data-form-error]').textContent.toLowerCase()).toContain('timed out')
  })
})
