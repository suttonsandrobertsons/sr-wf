// File uploads: pick, validate, POST to the Cloudflare Worker, and route the
// returned URL into the field that submits.
//
// Split out of fields.js on 10 Sep 2026. 562 lines of HTTP client — XHR with
// progress, abort and supersession, MIME sniffing, R2 URLs — is not what
// anyone expects to find in a file called "fields".
//
// The Worker is suttons-form-helper. It gates on the X-Suttons-Client header,
// which is public (it ships in the bundle) and is a bot filter, not auth.
//
// One import cycle survives the split and predates it:
// fields -> uploads -> navigation -> fields. Every edge is dereferenced inside
// a method, never at module scope, so ESM resolves it. Closing it means moving
// getFieldKey and validateScope out of formFields, which is a larger change
// than it is worth.

import { SELECTORS, formConfig, isEnabledAttribute } from './shared.js';
import { formLogger, formDom } from './dom.js';
import { getFormApp } from './lazy-app.js';
import { formParams } from './navigation.js';
import { formAttribution } from './attribution.js';
import { setFilled } from './field-state.js';

export const formUploads = {
  tempInputs: new WeakMap(),
  // Per-widget nonce: each new file selection bumps the token so a slower prior
  // request (e.g. file A) can be detected as stale and ignored when it finally
  // resolves — it must never overwrite the value written by a newer file (B).
  uploadTokens: new WeakMap(),
  // The AbortController for the in-flight request per widget, so a new selection
  // can abort the previous one instead of racing it.
  uploadControllers: new WeakMap(),

  isLoading(upload) {
    if (!upload) return false;
    return (upload.getAttribute('data-form-state') || '').split(' ').includes('loading');
  },

  open(form, upload) {
    if (!upload) {
      throw new Error('Upload action used outside a [data-form-upload] element.');
    }

    if (this.tempInputs.has(upload)) {
      formLogger.warn(form, 'Upload already in progress, ignoring click.');
      return;
    }

    const input = this.createTempInput();
    const cleanupTimer = window.setTimeout(() => {
      window.removeEventListener('focus', onFocus);
      this.removeTempInput(upload);
    }, formConfig.uploads.tempFileTimeoutMs);
    let selectionHandled = false;
    let focusTimer = null;

    const releaseIfCancelled = () => {
      if (selectionHandled) return;
      if (input.files && input.files.length) return;
      selectionHandled = true;
      window.clearTimeout(cleanupTimer);
      if (focusTimer) window.clearTimeout(focusTimer);
      window.removeEventListener('focus', onFocus);
      this.removeTempInput(upload);
      formLogger.log(form, 'Upload picker closed without a selection.');
    };

    const onFocus = () => {
      focusTimer = window.setTimeout(releaseIfCancelled, 250);
    };

    // Defensive: drop any stale temp <input type=file> left behind by an
    // interrupted pick before appending a fresh one.
    upload.querySelectorAll('input[type="file"]').forEach((stale) => stale.remove());

    this.tempInputs.set(upload, input);
    upload.appendChild(input);

    input.addEventListener('change', (event) => {
      selectionHandled = true;
      if (focusTimer) window.clearTimeout(focusTimer);
      window.removeEventListener('focus', onFocus);
      this.handleTempInputChange(form, upload, input, cleanupTimer, event);
    });
    input.addEventListener('cancel', releaseIfCancelled, { once: true });
    window.addEventListener('focus', onFocus);

    input.click();
  },

  createTempInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    return input;
  },

  handleTempInputChange(form, upload, input, cleanupTimer, event) {
    event.stopPropagation();
    window.clearTimeout(cleanupTimer);

    const file = input.files && input.files[0];
    this.removeTempInput(upload);

    if (!file) {
      formLogger.log(form, 'Upload cancelled (no file selected).');
      return;
    }

    formLogger.log(form, 'Upload temp input change.', { name: file.name, type: file.type, size: file.size });

    this.handle(form, upload, file)
      .then(() => {
        getFormApp().refresh(form);
        formParams.update(form);
      })
      .catch((error) => {
        formLogger.error(form, 'Temporary upload handler failed.', { error: error.message, stack: error.stack });
      });
  },

  removeTempInput(upload) {
    const input = this.tempInputs.get(upload);
    if (input) {
      if (input.parentNode) {
        input.remove();
      }
      this.tempInputs.delete(upload);
    }
  },

  ALLOWED_MIME_TYPES: new Set(formConfig.uploads.allowedMimeTypes),

  ALLOWED_EXTENSIONS: new Set(formConfig.uploads.allowedExtensions),

  isFileTypeAllowed(file) {
    if (file.type && this.ALLOWED_MIME_TYPES.has(file.type)) return true;
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    return this.ALLOWED_EXTENSIONS.has(ext);
  },

  handle(form, upload, file) {
    // Supersede any prior in-flight upload for this widget: bump the nonce and
    // abort the previous request so a late completion is ignored (see
    // uploadToWorker's stale check).
    const token = (this.uploadTokens.get(upload) || 0) + 1;
    this.uploadTokens.set(upload, token);
    const priorController = this.uploadControllers.get(upload);
    if (priorController) priorController.abort();
    this.uploadControllers.delete(upload);

    this.clear(upload);

    if (!file) return Promise.resolve();

    const valueField = upload.querySelector(SELECTORS.uploadValue);
    const workerBase = this.getWorkerBase();

    if (!valueField) {
      formLogger.error(form, 'Upload missing [data-form-upload-value-image] (or [data-form-upload-value]) hidden field.');
      this.setError(upload, 'Upload configuration error.');
      return Promise.resolve();
    }

    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);

    formLogger.log(form, 'Upload selected.', {
      name: file.name,
      size: file.size,
      sizeMB: sizeMB + ' MB',
      type: file.type || 'unknown',
      extension: ext,
    });

    if (!this.isFileTypeAllowed(file)) {
      const maxMb = Math.round((Number(formConfig.uploads.maxBytes) || 0) / (1024 * 1024)) || 20;
      const message = `That file type isn’t supported. Max ${maxMb}MB. Accepted: ${formConfig.uploads.acceptedLabel}.`;
      formLogger.warn(form, 'Upload rejected.', { name: file.name, type: file.type, extension: ext, reason: 'file_type_not_allowed' });
      this.setError(upload, message);
      return Promise.resolve();
    }

    if (this.isFileTooLarge(file)) {
      const maxMb = Math.round(formConfig.uploads.maxBytes / (1024 * 1024));
      const message = `File is too large. Please upload a file up to ${maxMb}MB.`;
      formLogger.warn(form, 'Upload rejected.', { name: file.name, size: file.size, maxBytes: formConfig.uploads.maxBytes, reason: 'file_too_large' });
      this.setError(upload, message);
      return Promise.resolve();
    }

    this.setLoading(upload, file);

    if (!workerBase) {
      const message = 'Upload service is not configured.';
      formLogger.error(form, 'Upload service not configured.');
      this.setError(upload, message);
      return Promise.resolve();
    }

    formLogger.log(form, 'Upload starting.', {
      name: file.name,
      workerUrl: workerBase + formConfig.uploads.workerUploadPath,
      formId: this.getFormId(form.root),
      fieldName: this.getFieldName(upload),
    });

    return this.uploadToWorker(form, upload, valueField, workerBase, file, token);
  },

  isFileTooLarge(file) {
    const maxBytes = Number(formConfig.uploads.maxBytes || 0);
    return maxBytes > 0 && file.size > maxBytes;
  },

  async uploadToWorker(form, upload, valueField, workerBase, file, token) {
    // The token this call was launched with — a fresher selection bumps
    // uploadTokens, so completion compares against the current value to
    // decide whether this result is still the one the customer is waiting for.
    const isStale = () => token !== undefined && this.uploadTokens.get(upload) !== token;

    // A lightweight controller object (not a fetch AbortController): postFile
    // assigns its .abort to xhr.abort() so a newer selection can cancel this
    // in-flight request via the same supersede path in handle().
    const controller = { abort: () => {} };
    this.uploadControllers.set(upload, controller);

    // Live upload progress: fetch has no upload-progress events, so a large file
    // (e.g. a 20MB video) would sit on a static "Uploading…" for many seconds and
    // look frozen. XHR updates the loading label with a percentage as the bytes
    // go out. Guard on isStale so a superseded upload never touches the UI.
    const onProgress = (event) => {
      if (isStale()) return;
      if (event && event.lengthComputable && event.total > 0) {
        const pct = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
        this.setUploadName(upload, `Uploading ${file.name}… ${pct}%`);
      }
    };

    try {
      formLogger.log(form, 'Upload posting to worker.', { name: file.name, endpoint: workerBase + formConfig.uploads.workerUploadPath });

      const json = await this.postFile(workerBase, {
        file,
        formId: this.getFormId(form.root),
        fieldName: this.getFieldName(upload),
        // Stable reference, generated once and reused for the hidden fields and
        // redirects at submit. The Worker folders uploads under this so the
        // Cloudflare storage path matches the Zoho record's reference.
        reference: formAttribution.ensureReference(form),
      }, controller, onProgress);

      // A newer selection superseded this request while it was in flight — its
      // result is stale, so ignore it entirely and never write over the newer
      // file's value/UI.
      if (isStale()) {
        formLogger.log(form, 'Ignoring stale upload completion (superseded by a newer selection).', { name: file.name });
        return;
      }

      const url = json.url || json.fileUrl || '';
      // A 200 with no usable URL (e.g. a body that parsed to an object without a
      // url) must not be treated as success — surface the error state instead of
      // silently writing an empty value that would pass validation.
      if (!url) {
        const friendly = new Error(this.friendlyUploadError('upload_failed'));
        friendly.code = 'empty_url';
        throw friendly;
      }

      formLogger.log(form, 'Upload worker responded.', { name: file.name, status: 'ok', url });
      formDom.setState(upload, 'loading', false);
      formDom.setState(upload, 'invalid', false);
      formDom.setState(upload, 'uploaded', true);
      this.setUploadName(upload, file.name);
      this.routeUploadValue(upload, valueField, json.category, url);
      // Stash the signed folder link (same for every file in the enquiry) so
      // submit can emit it as one hidden field. The form can't build this
      // itself — it's HMAC-signed by the Worker — so it comes from the response.
      if (json.folderUrl) {
        form.submissionMeta = form.submissionMeta || {};
        form.submissionMeta.folderUrl = json.folderUrl;
      }
      const error = upload.querySelector(SELECTORS.error);
      if (error) error.textContent = '';
      formLogger.log(form, 'Upload completed.', { name: file.name, url });
    } catch (error) {
      // If this request was superseded/aborted by a newer selection, stay silent
      // — the newer request owns the widget's state now.
      if (isStale() || error.name === 'AbortError') {
        formLogger.log(form, 'Ignoring aborted/stale upload error.', { name: file.name, code: error.code || error.name || 'unknown' });
        return;
      }
      formDom.setState(upload, 'loading', false);
      const errorMsg = error.message || this.friendlyUploadError('upload_failed');
      this.setError(upload, errorMsg);
      formLogger.error(form, 'Upload failed.', { name: file.name, code: error.code || 'unknown', error: errorMsg, stack: error.stack });
    } finally {
      if (this.uploadControllers.get(upload) === controller) {
        this.uploadControllers.delete(upload);
      }
    }
  },

  // Translate Worker/network error codes into a message fit to show a customer.
  // The Worker intentionally returns terse codes (good for logs/API); the UI
  // must never surface those raw (e.g. "conversion_failed").
  friendlyUploadError(code) {
    const maxMb = Math.round((Number(formConfig.uploads.maxBytes) || 0) / (1024 * 1024)) || 20;
    const messages = {
      conversion_failed: "We couldn’t process that image. Please try a different photo, or upload it as a JPG or PNG.",
      conversion_unavailable: "Image processing is temporarily unavailable. Please try again in a moment.",
      file_too_large: `That file is too large. Please upload a file up to ${maxMb}MB.`,
      file_too_large_to_convert: `That image is too large to process. Please upload one up to ${maxMb}MB.`,
      image_too_large_after_compression: "That image is too large to upload even after compression. Please upload a smaller photo (up to 10MB).",
      file_content_mismatch: "That file doesn’t look like a valid image. Please upload a genuine photo (JPG, PNG, GIF or WebP).",
      file_empty: "That file appears to be empty. Please select a valid file and try again.",
      file_type_not_allowed: `That file type isn’t supported. Max ${maxMb}MB. Accepted: ${formConfig.uploads.acceptedLabel}.`,
      file_required: "We didn’t receive the file. Please try selecting it again.",
      multipart_required: "Something went wrong sending your file. Please try again.",
      forbidden: "We couldn’t accept that upload. Please refresh the page and try again.",
      upload_failed: "Upload failed. Please try again.",
      network_error: "We couldn’t reach the upload server. Please check your connection and try again.",
      timeout: "The upload timed out. Please try again.",
    };
    return messages[code] || "Upload failed. Please try again.";
  },

  postFile(workerBase, data, controller, onProgress) {
    const body = new FormData();
    body.append('file', data.file);
    body.append('formId', data.formId);
    body.append('field', data.fieldName);
    if (data.reference) body.append('reference', data.reference);

    const url = workerBase.replace(/\/$/, '') + formConfig.uploads.workerUploadPath;

    // XMLHttpRequest, not fetch, so xhr.upload.onprogress can drive a live
    // percentage while bytes go out: supersede via controller.abort → xhr.abort,
    // a 60s cap via xhr.timeout, a hard throw on an unparseable 2xx body, and
    // the same Worker error-code surfacing.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Wire the caller's controller (from uploadToWorker) to xhr.abort so a newer
      // selection can cancel this request via the same supersede path.
      if (controller) controller.abort = () => xhr.abort();

      try {
        xhr.open('POST', url);
      } catch (error) {
        formLogger.error(null, 'Upload request could not be opened.', { url, error: error.message });
        const friendly = new Error(this.friendlyUploadError('network_error'));
        friendly.code = 'network_error';
        reject(friendly);
        return;
      }

      // ~60s cap, equivalent to the old fetch timeout. xhr fires ontimeout and
      // aborts internally; no manual timer to clear.
      xhr.timeout = 60000;
      xhr.setRequestHeader(formConfig.uploads.clientHeaderName, formConfig.uploads.clientHeaderValue);

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = onProgress;
      }

      xhr.onload = () => {
        const status = xhr.status;
        let json;
        let parsed = true;
        try {
          json = JSON.parse(xhr.responseText);
        } catch (parseError) {
          parsed = false;
          json = {};
        }

        if (status < 200 || status >= 300) {
          formLogger.error(null, 'Upload worker rejected file.', {
            url,
            status,
            statusText: xhr.statusText,
            error: json.error || json.message || 'unknown',
            fileName: data.file.name,
            fileType: data.file.type,
            fileSize: data.file.size,
          });
          const code = json.error || json.message || `http_${status}`;
          const friendly = new Error(this.friendlyUploadError(code));
          friendly.code = code;
          reject(friendly);
          return;
        }

        // A 2xx whose body could not be parsed as JSON is NOT a success — the
        // required URL is unknowable, so throw rather than return {} (which would
        // otherwise be marked uploaded with an empty value).
        if (!parsed) {
          formLogger.error(null, 'Upload worker response could not be parsed.', { url, status });
          const friendly = new Error(this.friendlyUploadError('upload_failed'));
          friendly.code = 'parse_failed';
          reject(friendly);
          return;
        }

        resolve(json);
      };

      xhr.onerror = () => {
        // A genuine network/CORS failure maps to network_error. (A supersede
        // abort takes the onabort path below, not this one.)
        formLogger.error(null, 'Upload request failed (network/CORS).', { url });
        const friendly = new Error(this.friendlyUploadError('network_error'));
        friendly.code = 'network_error';
        reject(friendly);
      };

      xhr.ontimeout = () => {
        formLogger.error(null, 'Upload request timed out.', { url });
        const friendly = new Error(this.friendlyUploadError('timeout'));
        friendly.code = 'timeout';
        reject(friendly);
      };

      xhr.onabort = () => {
        // A supersede-triggered abort must surface as AbortError so the caller's
        // stale check stays silent (matching the old fetch AbortController path).
        const abortError = new Error('Upload aborted.');
        abortError.name = 'AbortError';
        reject(abortError);
      };

      xhr.send(body);
    });
  },

  getFormId(formRoot) {
    return formRoot.getAttribute('data-form') || formRoot.id || 'form';
  },

  getFieldName(upload) {
    return upload.getAttribute('data-form-upload') || upload.getAttribute('data-form-upload-name') || 'upload';
  },

  getFieldLabel(upload) {
    const explicit = upload.getAttribute('data-form-upload-label')
      || upload.getAttribute('aria-label')
      || upload.querySelector(SELECTORS.uploadTrigger)?.textContent
      || this.getFieldName(upload);

    return String(explicit || 'file')
      .replace(/[_-]+/g, ' ')
      .replace(/\b(url|file|upload)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase() || 'file';
  },

  getWorkerBase() {
    return formConfig.uploads.workerBase || null;
  },

  setUploadValue(valueField, value) {
    if (!valueField) return;
    valueField.value = value;
    setFilled(valueField);
  },

  // WHY TWO VALUE FIELDS: Zoho has TWO distinct upload fields with different
  // format acceptance — Image Upload (jpg/png only, 10 MB cap) and File Upload
  // (everything else, including video). Zapier maps each to its own Zoho field
  // with no branching, which only works if the browser has already sorted the
  // URL into the right box.
  //
  // Images
  // (incl. WebP/HEIC/HEIF converted to JPEG) go to the primary value field
  // (→ Zoho Image Upload); documents and videos go to the file value field
  // (→ Zoho File Upload). If a widget has no dedicated file target, everything
  // falls back to the primary field. The non-matching field is always cleared so
  // re-selecting a different file type can't leave a stale URL behind.
  routeUploadValue(upload, valueField, category, value) {
    const fileField = upload.querySelector(SELECTORS.uploadValueFile);
    if (category === 'file' && fileField) {
      this.setUploadValue(fileField, value);
      this.setUploadValue(valueField, '');
    } else {
      this.setUploadValue(valueField, value);
      this.setUploadValue(fileField, '');
    }
  },

  setUploadName(upload, text) {
    const nameElement = upload.querySelector(SELECTORS.uploadName);
    if (nameElement) nameElement.textContent = text;
  },

  setLoading(upload, file) {
    formDom.setState(upload, 'loading', true);
    formDom.setState(upload, 'invalid', false);
    formDom.setState(upload, 'uploaded', false);
    this.setUploadName(upload, `Uploading ${file.name}...`);
  },

  validate(upload) {
    if (formDom.isConditionHidden(upload) || formDom.isStepHidden(upload) || formDom.isVisuallyHidden(upload)) return true;

    const valueField = upload.querySelector(SELECTORS.uploadValue);
    if (!valueField) {
      throw new Error('[data-form-upload] needs a [data-form-upload-value-image] (or [data-form-upload-value]) hidden field.');
    }

    // A file is still uploading. Block submit/step-nav regardless of whether
    // the field is required — the customer did attach a file, so hand-off (or
    // advance) must not proceed with an empty URL. Leave the loading state
    // untouched so the in-flight request can still complete.
    if (this.isLoading(upload)) {
      formLogger.warn(null, 'Upload validation blocked (still uploading).', { fieldName: this.getFieldName(upload) });
      const error = upload.querySelector(SELECTORS.error);
      if (error) error.textContent = 'Please wait for uploads to finish.';
      return false;
    }

    const isRequired = isEnabledAttribute(upload, 'data-form-field-required');
    if (!isRequired) return true;

    // A required upload is satisfied by EITHER target: an image lands in the
    // primary value field, a document/video in the file value field.
    const fileField = upload.querySelector(SELECTORS.uploadValueFile);
    const fieldHasValue = (f) => Boolean(f && f.value.trim() && !f.disabled);
    if (fieldHasValue(valueField) || fieldHasValue(fileField)) return true;

    formLogger.warn(null, 'Upload validation failed (required but empty).', { fieldName: this.getFieldName(upload) });
    this.setError(upload, `Upload ${this.getFieldLabel(upload)}`);
    return false;
  },

  reset(upload) {
    if (!upload) return;
    const valueField = upload.querySelector(SELECTORS.uploadValue);

    this.setUploadName(upload, '');

    if (valueField) {
      valueField.value = '';
      setFilled(valueField);
    }

    this.clear(upload);
  },

  clear(upload) {
    formDom.setState(upload, 'loading', false);
    formDom.setState(upload, 'uploaded', false);
    formDom.setState(upload, 'invalid', false);

    const valueField = upload.querySelector(SELECTORS.uploadValue);
    const fileField = upload.querySelector(SELECTORS.uploadValueFile);
    const error = upload.querySelector(SELECTORS.error);

    this.setUploadName(upload, '');
    if (valueField) this.setUploadValue(valueField, '');
    if (fileField) this.setUploadValue(fileField, '');
    if (error) error.textContent = '';
  },

  setError(upload, message) {
    formDom.setState(upload, 'loading', false);
    formDom.setState(upload, 'invalid', true);
    formDom.setState(upload, 'uploaded', false);

    // Clear any prior successful upload URL so a stale value can't pass validation.
    const valueField = upload.querySelector(SELECTORS.uploadValue);
    const fileField = upload.querySelector(SELECTORS.uploadValueFile);
    if (valueField) this.setUploadValue(valueField, '');
    if (fileField) this.setUploadValue(fileField, '');

    const error = upload.querySelector(SELECTORS.error);
    if (error) error.textContent = message;
  },
};

// ============================================================================
// FIELD VALIDATION & CONFIGURATION
// ============================================================================
