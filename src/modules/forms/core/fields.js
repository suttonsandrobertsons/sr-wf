import { SELECTORS, formConfig, fieldTypes, fieldFilters, fieldValidators, fieldRules, cleanPhoneInput, parseNumber, escapeSelector, isEnabledAttribute, formatGroupValue } from './shared.js';
import { formLogger, formDom } from './dom.js';
import { formChoices } from './choices.js';
import { getFormApp } from './lazy-app.js';
import { formParams, formAttribution } from './conditions.js';

export const formValues = {
  get(root, fieldName) {
    const checkboxes = root.querySelectorAll(`input[type='checkbox'][data-form-name='${formDom.escape(fieldName)}']`);
    if (checkboxes.length) {
      return Array.from(checkboxes)
        .filter((field) => this.shouldReadField(field))
        .flatMap((field) => this.getControlValues(field))
        .filter((value) => value !== '');
    }

    const groupedCheckboxes = root.querySelectorAll(`input[type='checkbox'][data-form-group-name='${formDom.escape(fieldName)}']`);
    if (groupedCheckboxes.length) {
      return Array.from(groupedCheckboxes)
        .filter((field) => this.shouldReadField(field))
        .flatMap((field) => this.getControlValues(field))
        .filter((value) => value !== '');
    }

    return Array.from(root.querySelectorAll(formDom.getNameSelector(fieldName)))
      .filter((field) => this.shouldReadField(field))
      .flatMap((field) => {
        return this.getControlValues(field);
      })
      .filter((value) => value !== '');
  },

  getControlValues(field) {
    if (this.isChoiceField(field)) {
      return field.checked ? [field.value] : [];
    }

    if (field.tagName === 'SELECT' && field.multiple) {
      return Array.from(field.selectedOptions).map((option) => {
        return option.value;
      });
    }

    return [field.value];
  },

  shouldReadField(field) {
    return !this.shouldOmitControl(field);
  },

  shouldDisableControl(control) {
    if (formDom.isConditionHidden(control)) return true;
    if (control.type === 'file') return true;
    return false;
  },

  shouldDisableControlDuringRender(control) {
    return control.type === 'file';
  },

  shouldOmitControl(control) {
    return control.disabled || this.shouldDisableControl(control);
  },

  setHidden(root, name, value) {
    let field = root.querySelector(formDom.getNameSelector(name, 'input'));

    if (!field) {
      field = document.createElement('input');
      field.type = 'hidden';
      field.name = name;
      root.appendChild(field);
    }

    field.value = value;
    field.disabled = false;
    return field;
  },

  hasFieldValue(root, field) {
    if (!this.shouldReadField(field)) return false;
    return this.hasControlValue(root, field);
  },

  hasControlValue(root, control) {
    if (control.type === 'radio') {
      return control.name ? this.get(root, control.name).length > 0 : control.checked;
    }

    if (control.type === 'checkbox') {
      return control.checked;
    }

    if (control.type === 'file') {
      return Boolean(control.files && control.files.length);
    }

    if (control.tagName === 'SELECT' && control.multiple) {
      return Array.from(control.selectedOptions).some((option) => {
        return option.value !== '';
      });
    }

    return Boolean(control.value && control.value.trim());
  },

  isChoiceField(field) {
    return field.type === 'checkbox' || field.type === 'radio';
  },

  parseMoney: parseNumber,
};

// ============================================================================
// FILE UPLOADS SYSTEM
// ============================================================================
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
    formFields.setFilled(valueField);
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
      formFields.setFilled(valueField);
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
export const formFields = {
  configure(form) {
    this.applyStartChecked(form);

    formDom.getFields(form.root).forEach((wrapper) => {
      const field = this.getInputFromWrapper(wrapper);
      if (!field) return;
      this.moveNativeRequiredToDataAttribute(field);
      this.applyFieldType(field);
      this.setFilled(field);
    });
    formChoices.configure(form);
  },

  applyStartChecked(form) {
    form.root.querySelectorAll('[data-form-field-start-checked]').forEach((source) => {
      if (!isEnabledAttribute(source, 'data-form-field-start-checked')) return;

      const input = source.matches?.(SELECTORS.choiceInput)
        ? source
        : source.querySelector?.(SELECTORS.choiceInput);

      if (!input || input.disabled || (input.type !== 'radio' && input.type !== 'checkbox')) return;
      if (input.type === 'radio' && input.name) {
        const checkedGroupInput = form.root.querySelector(`input[type='radio'][name="${escapeSelector(input.name)}"]:checked`);
        if (checkedGroupInput && checkedGroupInput !== input) return;
      }

      input.checked = true;
    });
  },

  getInputFromWrapper(wrapper) {
    return wrapper.querySelector('input:not([type="hidden"])') || wrapper.querySelector('select, textarea');
  },

  moveNativeRequiredToDataAttribute(field) {
    const source = this.getRequiredSource(field);
    if (field.required) {
      source.setAttribute('data-form-field-required', 'true');
    }
    field.required = false;
  },

  applyFieldType(field) {
    const fieldType = this.getFieldType(field);
    const preset = fieldTypes[fieldType];
    const rule = this.getFieldRule(field);

    if (preset?.inputType && field.tagName === 'INPUT') {
      field.setAttribute('type', preset.inputType);
    }
    this.applyManagedAttributes(field, { ...(preset || {}), ...(rule || {}) });
  },

  applyManagedAttributes(field, attributes) {
    formConfig.managedAttributes.forEach((attribute) => {
      this.applyManagedAttribute(field, attribute, attributes[attribute]);
    });
  },

  applyManagedAttribute(field, attribute, value) {
    if (value === undefined || value === null || value === '') {
      field.removeAttribute(attribute);
      return;
    }
    field.setAttribute(attribute, value);
  },

  render(form) {
    Array.from(form.root.querySelectorAll('input, select, textarea, button')).forEach((control) => {
      control.disabled = formValues.shouldDisableControlDuringRender(control);
    });
    this.prepareSingleSubmitControls(form);

    formDom.getFields(form.root).forEach((wrapper) => {
      const field = this.getInputFromWrapper(wrapper);
      if (!field) return;
      const wrap = this.getWrap(field);
      const source = this.getRequiredSource(field);
      const isRequired = isEnabledAttribute(source, 'data-form-field-required')
        && !field.disabled;

      field.required = isRequired && !form.steps.length && this.shouldUseNativeRequired(field, source);
      this.setFilled(field);

      if (wrap) {
        formDom.setState(wrap, 'disabled', field.disabled);
      }
    });

  },

  filterInput(field) {
    const fieldType = this.getFieldType(field);
    if (fieldType === 'phone') {
      const before = field.value;
      const after = this.normalizePhoneValue(field);
      if (after === before) return;

      this.setFilteredValue(field, before, after);
      return;
    }

    const preset = fieldTypes[fieldType];
    const rule = this.getFieldRule(field);
    const filterName = preset?.filter || rule?.filter;
    const filter = filterName && fieldFilters[filterName];
    if (!filter) return;

    const before = field.value;
    const after = filter(before);
    if (after === before) return;

    this.setFilteredValue(field, before, after);
  },

  normalizeField(field) {
    const fieldType = this.getFieldType(field);
    if (fieldType === 'phone') {
      const before = field.value;
      const after = this.normalizePhoneValue(field);
      if (after !== before) field.value = after;
    }

    // Zoho's email field rejects a stray leading/trailing dot or whitespace
    // (e.g. "jo@x.com." → the create/update Zap fails validation and the lead
    // is lost). Strip them on blur and again at submit so what reaches Zapier
    // is clean. Internal dots (sub.domains, first.last) are left untouched.
    if (fieldType === 'email') {
      const before = field.value;
      const after = before.replace(/^[.\s]+|[.\s]+$/g, '');
      if (after !== before) field.value = after;
    }

    // On blur/change, keep money fields formatted for display (with thousands
    // separators). The comma is only stripped at submit time in
    // normalizeBeforeSubmit, so the customer keeps seeing "10,000" after
    // clicking out while Zapier/Zoho still receive a plain "10000".
    if (fieldType === 'money') {
      this.formatMoneyField(field);
    }
  },

  normalizeBeforeSubmit(form) {
    formDom.getFields(form.root).forEach((wrapper) => {
      const field = this.getInputFromWrapper(wrapper);
      if (!field) return;
      this.normalizeField(field);
      // Strip display formatting (commas) from money fields so the submitted
      // payload is a plain number. Must stay here — sync/mirror forms re-read
      // these values after this step (sync.submitToTarget).
      if (this.getFieldType(field) === 'money') this.cleanMoneyFieldForSubmit(field);
    });
  },

  prepareControlsForSubmit(form) {
    const root = form?.root;
    if (!root) return;

    formDom.getControls(root).forEach((control) => {
      if (control.type === 'hidden' &&
          (control.hasAttribute('data-form-checkbox-list') || control.hasAttribute('data-form-field-list'))) {
        return;
      }
      control.disabled = formValues.shouldDisableControl(control);
    });
    this.prepareSingleSubmitControls(form);

    formChoices.prepareFieldsForSubmit(form);
  },

  // Some fields (e.g. New_Lead_Type, box_and_papers, bullion_name — see
  // formConfig.submit.singleValueFieldNames) are authored as several controls
  // that must collapse to one submitted name. Renaming the inactive controls
  // with the disabled-name prefix, rather than disabling them, is deliberate:
  // this runs on every render, and a disabled control can't be typed into —
  // the customer would be locked out of switching which control is active.
  prepareSingleSubmitControls(form) {
    const root = form?.root;
    if (!root) return;

    const singleSubmitNames = this.getSingleSubmitFieldNames(root);
    const disabledNamePrefix = formConfig.submit?.disabledNamePrefix || '_disabled_';
    const groups = new Map();

    root.querySelectorAll('[name], [data-form-submit-original-name], [data-form-submit-single]').forEach((control) => {
      const originalName = control.getAttribute('data-form-submit-original-name') || control.getAttribute('name') || '';
      const currentName = control.getAttribute('name') || originalName;
      const isConfiguredName = singleSubmitNames.has(originalName) || singleSubmitNames.has(currentName);
      const hasOptIn = control.hasAttribute('data-form-submit-single');

      if (!isConfiguredName && !hasOptIn) return;

      const explicitGroup = control.getAttribute('data-form-submit-single') || '';
      const submitName = originalName || currentName;
      const groupKey = explicitGroup && explicitGroup !== 'true' ? explicitGroup : submitName;
      if (!submitName || !groupKey) return;

      control.setAttribute('data-form-submit-original-name', submitName);
      control.setAttribute('name', submitName);
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(control);
    });

    groups.forEach((controls) => {
      const activeControl = controls.find((control) => {
        if (formValues.shouldDisableControlDuringRender(control)) return false;
        if (formDom.isConditionHidden(control) || formDom.isStepHidden(control)) return false;
        return String(control.value || '').trim() !== '';
      });

      controls.forEach((control) => {
        const originalName = control.getAttribute('data-form-submit-original-name') || control.getAttribute('name');
        const isActive = control === activeControl;
        control.disabled = false;
        control.setAttribute('name', isActive ? originalName : `${disabledNamePrefix}${originalName}`);
      });
    });
  },

  getSingleSubmitFieldNames(root) {
    const names = [
      ...(formConfig.submit?.singleValueFieldNames || []),
      ...String(root.getAttribute('data-form-submit-single-names') || '').split(','),
    ];

    return new Set(
      names
        .map((name) => String(name || '').trim())
        .filter(Boolean),
    );
  },

  normalizePhoneValue(field) {
    const cleanValue = cleanPhoneInput(field.value);
    const countryField = this.getPhoneCountryField(field);
    const detectedCountryCode = this.getAutofilledPhoneCountryCode(cleanValue, countryField);
    if (detectedCountryCode && countryField && countryField.value !== detectedCountryCode) {
      countryField.value = detectedCountryCode;
      countryField.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const countryCode = detectedCountryCode || String(countryField?.value || '').trim();
    if (!countryCode) return cleanValue;

    const countryDigits = countryCode.replace(/\D/g, '');
    const toVisibleNationalNumber = (digits) => digits.replace(/^0+/, '');
    if (!countryDigits) return cleanValue;

    if (cleanValue.startsWith('+')) {
      const digits = cleanValue.replace(/\D/g, '');
      if (digits.startsWith(countryDigits) && digits.length > countryDigits.length) {
        return toVisibleNationalNumber(digits.slice(countryDigits.length));
      }
      return cleanValue;
    }

    const digits = cleanValue.replace(/\D/g, '');

    if (digits.startsWith('00' + countryDigits) && digits.length > countryDigits.length + 2) {
      return toVisibleNationalNumber(digits.slice(countryDigits.length + 2));
    }

    if (digits.startsWith(countryDigits) && digits.length > countryDigits.length) {
      return toVisibleNationalNumber(digits.slice(countryDigits.length));
    }

    return toVisibleNationalNumber(cleanValue);
  },

  getSelectedPhoneCountryCode(field) {
    return String(this.getPhoneCountryField(field)?.value || '').trim();
  },

  // Phone is the one field authored as two controls under a single wrapper:
  // the country-code select and the number input. The wrapper owns the type,
  // validation and error state; the select is found by name from the form
  // root so the two need not be siblings in the markup. buildPhoneValue joins
  // them for submission; the reverse split happens on quote_url prefill.
  getPhoneCountryField(field) {
    const root = field.closest(SELECTORS.root) || field.form || document;
    return root.querySelector(formDom.getNameSelector('phone_country_code'));
  },

  getAutofilledPhoneCountryCode(cleanValue, countryField) {
    const digits = cleanValue.replace(/\D/g, '');
    if (!digits || (!cleanValue.startsWith('+') && !cleanValue.startsWith('00'))) return '';

    const candidates = this.getPhoneCountryCodeCandidates(countryField);
    const normalizedDigits = cleanValue.startsWith('00') ? digits.slice(2) : digits;
    return candidates.find((candidate) => {
      const candidateDigits = candidate.replace(/\D/g, '');
      return candidateDigits && normalizedDigits.startsWith(candidateDigits) && normalizedDigits.length > candidateDigits.length;
    }) || '';
  },

  getPhoneCountryCodeCandidates(countryField) {
    const values = [];
    if (countryField?.value) values.push(countryField.value);
    const options = Array.from(countryField?.options || []);
    options.forEach((option) => {
      if (option.value) values.push(option.value);
    });

    if (!options.length && !values.some((value) => value.replace(/\D/g, '') === '44')) {
      values.push('+44');
    }

    return values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length);
  },

  formatMoneyField(field) {
    const raw = String(field.value || '').trim();
    if (!raw) return;

    const number = formValues.parseMoney(raw);
    if (!Number.isFinite(number)) return;

    field.value = new Intl.NumberFormat('en-GB', {
      maximumFractionDigits: raw.includes('.') ? 2 : 0,
    }).format(number);
  },

  cleanMoneyFieldForSubmit(field) {
    const raw = String(field.value || '').trim();
    if (!raw) return;

    const number = formValues.parseMoney(raw);
    if (!Number.isFinite(number)) return;

    field.value = String(number);
  },

  setFilteredValue(field, before, after) {
    const start = field.selectionStart;
    field.value = after;

    if (typeof start !== 'number' || typeof field.setSelectionRange !== 'function') return;

    const offset = before.length - after.length;
    const position = Math.max(start - offset, 0);
    field.setSelectionRange(position, position);
  },

  setFilled(field) {
    const root = field.closest(SELECTORS.root) || document;
    const isFilled = formValues.hasFieldValue(root, field);
    const wrap = this.getWrap(field);

    formDom.setState(field, 'filled', isFilled);
    if (wrap) {
      formDom.setState(wrap, 'filled', isFilled);
    }
  },

  getFieldType(field) {
    if (this.shouldSkipType(field)) return '';

    const wrap = this.getWrap(field);
    const explicitType = wrap && wrap.getAttribute('data-form-field-type');
    if (explicitType) return explicitType;

    if (field.tagName === 'INPUT') {
      const nativeType = field.getAttribute('type') || field.type || '';
      if (nativeType === 'email') return 'email';
      if (nativeType === 'tel') return 'phone';
    }

    return 'text';
  },

  getFieldKey(field) {
    const wrapper = this.getWrap(field);
    if (wrapper && wrapper.getAttribute('data-form-field')) {
      return wrapper.getAttribute('data-form-field');
    }
    return field.getAttribute('name') || field.getAttribute('id') || '';
  },

  getFieldRule(field) {
    const key = this.getFieldKey(field);
    if (fieldRules[key]) return fieldRules[key];
    if (/^quantity_item_\d+$/.test(key)) return fieldRules.quantity || null;
    if (/^weight_grams/.test(key)) return fieldRules.weight_grams || null;
    return null;
  },

  shouldSkipType(field) {
    return formConfig.ignoredFieldTypes.has(field.type) || formConfig.ignoredTypePresetFields.has(field.type) || field.tagName === 'SELECT';
  },

  getRequiredSource(field) {
    const candidates = [
      this.getWrap(field),
      field.closest(SELECTORS.choice),
      field.closest(SELECTORS.choiceGroup),
      field,
    ];
    for (const el of candidates) {
      if (el && el.hasAttribute('data-form-field-required')) return el;
    }
    return candidates[0] || field;
  },

  getWrap(field) {
    return field.closest(SELECTORS.field) || field.closest(SELECTORS.upload);
  },

  shouldUseNativeRequired(field, source) {
    if (formConfig.ignoredFieldTypes.has(field.type)) return false;
    if (field.type !== 'radio' && field.type !== 'checkbox') return true;

    const groupFields = formDom.getFields(source).filter((item) => {
      const input = this.getInputFromWrapper(item);
      return input && input.name === field.name && input.type === field.type;
    });

    return groupFields[0] === field;
  },

  validateScope(form, scope) {
    getFormApp().refresh(form);

    formLogger.log(form, 'validateScope starting.', { formId: form.key, scopeTag: scope.tagName });

    const invalidChoiceGroup = Array.from(scope.querySelectorAll(SELECTORS.choiceGroup)).find((group) => {
      return !this.validateChoiceGroup(form, group);
    });

    if (invalidChoiceGroup) {
      const firstInput = invalidChoiceGroup.querySelector('input');
      if (firstInput) firstInput.focus();
      const groupId = invalidChoiceGroup.getAttribute('data-form-choice-group') || invalidChoiceGroup.getAttribute('data-form-field') || 'unknown';
      formLogger.warn(form, 'Choice group validation failed.', { groupId });
      return false;
    }

    const invalidChoice = Array.from(scope.querySelectorAll(SELECTORS.choice)).find((choice) => {
      return !this.validateStandaloneChoice(form, choice);
    });

    if (invalidChoice) {
      const input = formChoices.getInput(invalidChoice);
      if (input) input.focus();
      const choiceName = input?.name || invalidChoice.getAttribute('data-form-field') || 'unknown';
      formLogger.warn(form, 'Standalone choice validation failed.', { name: choiceName });
      return false;
    }

    const invalidUpload = Array.from(scope.querySelectorAll(SELECTORS.upload)).find((upload) => {
      return !formUploads.validate(upload);
    });

    if (invalidUpload) {
      invalidUpload.focus();
      const uploadName = formUploads.getFieldName(invalidUpload);
      formLogger.warn(form, 'Upload validation failed.', { fieldName: uploadName });
      return false;
    }

    const invalidField = formDom.getFields(scope).find((wrapper) => {
      const field = this.getInputFromWrapper(wrapper);
      if (!field) return false;
      return !this.validateField(form, field);
    });

    if (!invalidField) {
      formLogger.log(form, 'validateScope passed.');
      return true;
    }

    const focusTarget = this.getInputFromWrapper(invalidField);
    if (focusTarget) focusTarget.focus();
    formLogger.warn(form, 'Field validation failed.', { name: this.getFieldKey(invalidField), type: focusTarget?.type, tagName: focusTarget?.tagName });
    return false;
  },

  validateChoiceGroup(form, group) {
    if (formDom.isConditionHidden(group) || formDom.isStepHidden(group) || formDom.isVisuallyHidden(group)) return true;

    const hasExplicitMin = group.hasAttribute('data-form-required-amount') || group.hasAttribute('data-form-group-min');
    const isRequired = isEnabledAttribute(group, 'data-form-field-required');

    if (!isRequired && !hasExplicitMin) {
      formDom.setState(group, 'invalid', false);
      const error = group.querySelector(SELECTORS.error);
      if (error) error.textContent = '';
      return true;
    }

    const parsedAmount = hasExplicitMin
      ? parseInt(
          group.getAttribute('data-form-required-amount') ||
          group.getAttribute('data-form-group-min') ||
          '1',
          10,
        )
      : 1;
    const explicitAmount = Number.isNaN(parsedAmount) ? 1 : parsedAmount;
    // A group marked required must need at least one selection, even if an
    // explicit min of 0 was supplied (an explicit 0 + required is contradictory).
    const requiredAmount = isRequired ? Math.max(explicitAmount, 1) : explicitAmount;
    const checkedCount = Array.from(group.querySelectorAll('input:checked')).filter((input) => {
      return !input.disabled && !formDom.isConditionHidden(input);
    }).length;

    if (checkedCount < requiredAmount) {
      formDom.setState(group, 'invalid', true);
      const error = group.querySelector(SELECTORS.error);
      const overrideMessage = group.getAttribute('data-form-field-error');
      if (error) {
        error.textContent = overrideMessage || `Please select at least ${requiredAmount} option${requiredAmount > 1 ? 's' : ''}.`;
      }
      return false;
    }

    formDom.setState(group, 'invalid', false);
    const error = group.querySelector(SELECTORS.error);
    if (error) error.textContent = '';
    return true;
  },

  validateStandaloneChoice(form, choice) {
    if (!choice) return true;
    if (choice.closest(SELECTORS.choiceGroup)) return true;
    if (formDom.isConditionHidden(choice) || formDom.isStepHidden(choice) || formDom.isVisuallyHidden(choice)) return true;

    const input = formChoices.getInput(choice);
    if (!input) return true;
    if (input.type === 'radio') return true;

    const source = this.getRequiredSource(input);
    const isRequired = isEnabledAttribute(source, 'data-form-field-required');
    if (!isRequired) {
      formDom.setState(choice, 'invalid', false);
      input.removeAttribute('aria-invalid');
      this.setStandaloneChoiceError(choice, '');
      return true;
    }

    const isValid = input.checked;
    formDom.setState(choice, 'invalid', !isValid);

    if (isValid) {
      input.removeAttribute('aria-invalid');
      this.setStandaloneChoiceError(choice, '');
      return true;
    }

    input.setAttribute('aria-invalid', 'true');
    this.setStandaloneChoiceError(choice, this.getStandaloneChoiceErrorMessage(choice));
    return false;
  },

  getStandaloneChoiceErrorMessage(choice) {
    return choice.getAttribute('data-form-field-error') || 'Please tick this box to continue.';
  },

  setStandaloneChoiceError(choice, message) {
    const error = choice.querySelector(SELECTORS.error);
    if (error) error.textContent = message;
  },

  validateField(form, field) {
    if (this.shouldSkipValidation(field)) return true;

    this.normalizeField(field);
    this.clearError(field);

    const fieldKey = this.getFieldKey(field.closest(SELECTORS.field) || field);

    if (this.isRequired(field) && !formValues.hasFieldValue(form.root, field)) {
      formLogger.warn(form, 'Field required but empty.', { name: fieldKey, type: field.type });
      this.setError(field, 'This field is required.');
      return false;
    }

    if (!formValues.hasFieldValue(form.root, field)) return true;

    const fieldType = this.getFieldType(field);
    const preset = fieldTypes[fieldType];
    const rule = this.getFieldRule(field);

    if (rule && !this.isValidRule(field, rule)) {
      formLogger.warn(form, 'Field rule validation failed.', { name: fieldKey, validateType: rule.validate, value: field.value });
      this.setError(field, rule.message || 'Enter a valid value.');
      return false;
    }

    if (!preset || !preset.validate) return true;

    if (!this.isValidValue(field, preset.validate)) {
      formLogger.warn(form, 'Field format validation failed.', { name: fieldKey, validateType: preset.validate, value: field.value });
      this.setError(field, preset.message || 'Enter a valid value.');
      return false;
    }

    return true;
  },

  isValidRule(field, rule) {
    if (rule.maxlength && String(field.value || '').length > Number(rule.maxlength)) return false;
    if (rule.min !== undefined || rule.max !== undefined) {
      const number = parseNumber(field.value);
      if (!Number.isFinite(number)) return false;
      if (rule.min !== undefined && number < Number(rule.min)) return false;
      if (rule.max !== undefined && number > Number(rule.max)) return false;
    }
    if (!rule.validate) return true;
    return this.isValidValue(field, rule.validate);
  },

  isValidValue(field, validateType) {
    const validator = fieldValidators[validateType];
    if (!validator) return true;
    return validator(field.value.trim());
  },

  isRequired(field) {
    const source = this.getRequiredSource(field);
    return isEnabledAttribute(source, 'data-form-field-required') && !formDom.isConditionHidden(field);
  },

  shouldSkipValidation(field) {
    return field.disabled || formConfig.ignoredFieldTypes.has(field.type) || formDom.isConditionHidden(field) || formDom.isStepHidden(field) || formDom.isVisuallyHidden(field);
  },

  setError(field, message) {
    const wrap = this.getWrap(field) || field;
    const error = wrap.querySelector(SELECTORS.error);

    field.setAttribute('aria-invalid', 'true');
    formDom.setState(wrap, 'invalid', true);

    if (error) {
      const overrideMessage = wrap.getAttribute('data-form-field-error');
      error.textContent = overrideMessage && overrideMessage.trim() !== '' ? overrideMessage : message;
    }
  },

  clearError(field) {
    const wrap = this.getWrap(field) || field;
    const error = wrap.querySelector(SELECTORS.error);

    field.removeAttribute('aria-invalid');
    formDom.setState(wrap, 'invalid', false);

    if (error) {
      error.textContent = '';
    }
  },

  reset(form) {
    form.root.reset();

    form.root.querySelectorAll(SELECTORS.upload).forEach((upload) => {
      formUploads.reset(upload);
    });

    form.stepIndex = 0;
  },

  clear(form) {
    formDom.getControls(form.root).forEach((control) => {
      const fieldName = control.getAttribute('data-form-name') || control.name;
      if (!fieldName || formConfig.ignoredFieldTypes.has(control.type)) return;
      if (control.type === 'file') return;

      if (formValues.isChoiceField(control)) {
        control.checked = false;
        const choice = control.closest(SELECTORS.choice);
        if (choice) {
          formDom.setState(choice, 'selected', false);
          choice.setAttribute('aria-checked', 'false');
        }
      } else if (control.tagName === 'SELECT' && control.multiple) {
        Array.from(control.options).forEach((option) => {
          option.selected = false;
        });
      } else if (control.tagName === 'SELECT') {
        control.value = '';
      } else {
        control.value = '';
      }

      this.setFilled(control);
      this.clearError(control);
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });

    form.root.querySelectorAll(SELECTORS.upload).forEach((upload) => {
      formUploads.reset(upload);
    });

    form.stepIndex = 0;
  },
};

// ============================================================================
// FIELD GROUPS
// ============================================================================
// Choice cards (radio/checkbox) are NOT here — they are in choices.js.
//
// A field group is the DECLARATIVE way to combine several fields into one
// submitted value: wrap them in [data-form-field-group="<name>"] to create a
// hidden input of that name holding the visible members' values, comma-joined.
// No JavaScript knows what is being combined — `brands` is built this way, and
// the same attribute would combine anything else.
//
// Use this when the answer is "whichever of these is filled in, joined". Use
// derived-fields.js instead when the value needs a rule a join cannot express:
// arithmetic, a conditional pick, or a mapping to differently-named outputs.
//
// The empty case does NOT differ from a derived field, despite what this
// comment used to claim. An empty group disables its hidden input — but
// Webflow's serialiser ignores `disabled` (no `:not(:disabled)` in its
// selector, and `.val()` reads disabled elements), so the field is still
// submitted, empty. Measured live on /get-a-quote: `brands=""` is in the
// payload. Both this and an empty derived field arrive as an empty value, so a
// Zapier mapping cannot distinguish them by presence.
//
// The ONLY mechanism here that produces a genuinely absent key is the
// single-submit dedup (submit.singleValueFieldNames), because it RENAMES the
// losers to `_disabled_<name>`. Renaming is the only thing Webflow respects.
// See docs/developer/twins.md in the private repository.
export const formFieldGroups = {
  render(form) {
    this.syncFields(form);
  },

  syncFields(form) {
    if (!form?.root) return;

    const groups = new Map();

    form.root.querySelectorAll('input, select, textarea').forEach((control) => {
      if (control.type === 'hidden' || control.matches(SELECTORS.choiceInput)) return;

      const group = control.closest(SELECTORS.fieldGroup);
      if (!group || !form.root.contains(group)) return;
      if (control.closest(SELECTORS.field) === group) return;

      const fieldName = this.getGroupName(group);
      if (!fieldName) return;

      if (!groups.has(fieldName)) {
        groups.set(fieldName, []);
      }
      groups.get(fieldName).push(control);
    });

    groups.forEach((controls, fieldName) => {
      const hidden = this.ensureHidden(form.root, fieldName);
      const values = controls.flatMap((control) => {
        if (!formValues.shouldReadField(control)) return [];
        return formValues.getControlValues(control).filter((value) => {
          return String(value || '').trim() !== '';
        });
      });

      if (!values.length) {
        hidden.value = '';
        hidden.disabled = true;
        return;
      }

      hidden.value = formatGroupValue(values);
      hidden.disabled = false;
    });
  },

  getGroupName(group) {
    const explicitName = (group.getAttribute('data-form-field-group') || '').trim();
    if (explicitName && explicitName !== 'true' && explicitName !== 'false') {
      return explicitName;
    }

    return (group.getAttribute('data-form-field') || '').trim();
  },

  ensureHidden(root, fieldName) {
    let hidden = root.querySelector(`input[type='hidden'][data-form-name='${formDom.escape(fieldName)}']`);
    if (!hidden) {
      hidden = root.querySelector(`input[type='hidden'][name='${formDom.escape(fieldName)}']`);
    }
    if (!hidden) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = fieldName;
      root.appendChild(hidden);
    }

    hidden.setAttribute('data-form-name', fieldName);
    hidden.setAttribute('data-form-field-list', 'true');
    return hidden;
  },
};

// ============================================================================
