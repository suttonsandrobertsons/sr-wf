// Where the lead came from: UTM capture, click ids, the lead reference, and
// `quote_url`.
//
// Persisted in localStorage with a cookie fallback and an in-memory last
// resort, so a blocked storage API degrades rather than throws. Values expire
// after 30 days without a fresh UTM.
//
// Split out of conditions.js on 9 Sep 2026.
//
// `brand` here is the quote_url coalescing, NOT the combined `brands` field
// built by formFieldGroups in aggregate.js. The two have been confused before.

import { formConfig, buildPhoneValue } from './shared.js';
import { formLogger } from './dom.js';
import { formValues } from './values.js';

const memoryStorage = {
  _data: {},
  getItem(key) {
    return this._data[key] || null;
  },
  setItem(key, value) {
    this._data[key] = String(value);
  }
};

const ATTRIBUTION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Success snapshots hold lightly-identifying data (reference etc.) only long
// enough for the TY page to hydrate. Expire after 30 min so nothing lingers.
export const SUCCESS_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

// Tracking keys that must never contain whitespace/control chars.
const TRACKING_VALUE_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];

// A valid UTM/click-id value never contains whitespace. WhatsApp (and some
// email clients) auto-link and greedily absorb trailing text — a "Hello"
// placed after the link turns `utm_medium=direct` into `direct Hello`.
// Uncaught, this corruption flows into storage, hidden fields, the dataLayer
// push, redirect params and the WhatsApp link itself, all the way to Zoho.
// Normalise control chars to spaces, trim, then keep only the first token —
// this single choke point cleans both inbound and already-persisted values.
function sanitizeUtmValue(v) {
  return String(v ?? '').replace(/[\u0000-\u0020]+/g, ' ').trim().split(/\s+/)[0] || '';
}

function sanitizeTrackingValues(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  TRACKING_VALUE_KEYS.forEach((key) => {
    if (obj[key] != null && obj[key] !== '') obj[key] = sanitizeUtmValue(obj[key]);
  });
  return obj;
}

// Cookie fallback for attribution: resilience against private browsing and
// localStorage quota limits.
function readCookie(name) {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const escaped = name.replace(/([.$?*|{}()\[\]\\\/+^])/g, '\\$1');
  const m = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function writeCookie(name, value, days = 30) {
  if (typeof document === 'undefined') return false;
  try {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    // Secure: the site is HTTPS-only, so restrict the cookie to secure
    // transport (defence-in-depth against attribution leaking over plain HTTP).
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax;Secure`;
    return true;
  } catch {
    return false;
  }
}

// Attribution capture and the form_submission dataLayer push are not gated
// here; consent is enforced upstream (Consent Pro + Google Consent Mode).
// Consent posture and rationale are kept in an internal note (not committed).

// Infer UTM-equivalent source/medium when no paid/UTM signals are present.
function inferUntrackedAttribution() {
  if (typeof document === 'undefined') return { utm_source: '', utm_medium: '' };
  const ref = document.referrer || '';
  if (!ref) return { utm_source: 'direct', utm_medium: 'direct' };
  try {
    const u = new URL(ref, window.location.origin);
    const h = (u.hostname || '').toLowerCase();
    const currentHost = (window.location.hostname || '').toLowerCase();
    if (!h || h === currentHost) return { utm_source: 'direct', utm_medium: 'direct' };

    let src = '';
    if (/(^|\.)google\./.test(h) || h.includes('googleusercontent')) src = 'google';
    else if (/(^|\.)bing\./.test(h)) src = 'bing';
    else if (/(^|\.)yahoo\./.test(h)) src = 'yahoo';
    else if (/(^|\.)duckduckgo\./.test(h)) src = 'duckduckgo';
    else if (/(^|\.)ecosia\./.test(h)) src = 'ecosia';
    else if (/(^|\.)baidu\./.test(h)) src = 'baidu';
    else if (/(^|\.)yandex\./.test(h)) src = 'yandex';
    if (src) return { utm_source: src, utm_medium: 'organic' };
    return { utm_source: h.replace(/^www\./, ''), utm_medium: 'referral' };
  } catch {
    return { utm_source: 'direct', utm_medium: 'direct' };
  }
}

// ATTRIBUTION, THE LEAD REFERENCE, AND quote_url
// ----------------------------------------------------------------------------

export const formAttribution = {
  // Exposed so callers reading UTM values from a source that bypasses the
  // store (e.g. the contact widget's raw-URL fallback) can apply the same
  // whitespace-corruption guard used at the capture/read choke point.
  sanitizeUtmValue,

  capture() {
    const storage = this.getStorage();
    const existing = this.readAttribution(storage);

    const firstLanding = existing.first_landing_url || existing.first_page || this.cleanUrl(window.location.href);
    const urlParams = new URLSearchParams(window.location.search);

    let utm_source = existing.utm_source || urlParams.get('utm_source') || '';
    let utm_medium = existing.utm_medium || urlParams.get('utm_medium') || '';
    let utm_campaign = existing.utm_campaign || urlParams.get('utm_campaign') || '';
    let utm_term = existing.utm_term || urlParams.get('utm_term') || '';
    let utm_content = existing.utm_content || urlParams.get('utm_content') || '';
    let gclid = existing.gclid || urlParams.get('gclid') || '';
    let fbclid = existing.fbclid || urlParams.get('fbclid') || '';

    // Organic referrer inference when no paid/UTM signal exists — a client requirement.
    const hasPaidSignal = Boolean(gclid || fbclid || utm_source || utm_medium || utm_campaign);
    let hasInferredSignal = false;
    if (!hasPaidSignal) {
      const inferred = inferUntrackedAttribution();
      if (inferred.utm_source && !utm_source) {
        utm_source = inferred.utm_source;
        utm_medium = inferred.utm_medium || '';
        hasInferredSignal = true;
      }
    }

    const merged = {
      first_landing_url: firstLanding,
      first_page: firstLanding,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      gclid,
      fbclid,
      captured_at: existing.captured_at || Date.now(),
    };

    // Update if new UTM params arrived (re-entry from ad click)
    let hasNewUtm = false;
    formConfig.attribution.utmParams.forEach((param) => {
      const incoming = urlParams.get(param);
      if (incoming) {
        merged[param] = incoming;
        hasNewUtm = true;
      }
    });
    formConfig.attribution.clickIdParams.forEach((param) => {
      const incoming = urlParams.get(param);
      if (incoming) {
        merged[param] = incoming;
        hasNewUtm = true;
      }
    });

    // Reset timer when new tracking params arrive
    if (hasNewUtm || hasInferredSignal) merged.captured_at = Date.now();

    // Expire stale attribution (older than 30 days with no new UTM refresh)
    const age = Date.now() - (merged.captured_at || 0);
    if (age > ATTRIBUTION_MAX_AGE_MS && !hasNewUtm && !hasInferredSignal) {
      merged.utm_source = '';
      merged.utm_medium = '';
      merged.utm_campaign = '';
      merged.utm_term = '';
      merged.utm_content = '';
      merged.gclid = '';
      merged.fbclid = '';
      merged.captured_at = Date.now();
    }

    // Neutralise any whitespace-corrupted UTM/click-id before it is persisted
    // or read by any downstream consumer (see sanitizeUtmValue above).
    sanitizeTrackingValues(merged);

    const writeOk = this.writeAttribution(storage, merged);
    if (!writeOk) {
      // Try cookie fallback for the critical keys so attribution survives private browsing / quota issues
      const cookiePayload = {
        first_landing_url: merged.first_landing_url,
        first_page: merged.first_page,
        utm_source: merged.utm_source,
        utm_medium: merged.utm_medium,
        utm_campaign: merged.utm_campaign,
        utm_term: merged.utm_term,
        utm_content: merged.utm_content,
        gclid: merged.gclid,
        fbclid: merged.fbclid,
        captured_at: merged.captured_at,
      };
      const cookieOk = writeCookie('sr_attribution', JSON.stringify(cookiePayload), 30);
      if (!cookieOk) {
        console.warn('[Suttons Attribution] Failed to persist attribution to storage and cookie. UTM data may be lost on next page load.');
      }
    }
    formLogger.log(null, 'Attribution captured.', { writeOk, hasNewUtm, ageMs: age });
  },

  getLeadReference(form) {
    const lastName = this.getLastName(form);
    // Surname anchor: uppercase A–Z only, capped so a long or edge-case name
    // can't bloat the reference (customers read it over the phone) or overflow
    // the Worker's 80-char safeReference cap. Falls back to "SR" when a name
    // strips to nothing (e.g. non-Latin characters -> empty).
    const prefix = String(lastName || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 20) || 'SR';

    // 40 bits of randomness as two 4-char Crockford base32 groups (no
    // ambiguous I L O U, no 0/O or 1/l confusion) for reading aloud. Carries
    // both uniqueness (a clash needs the same surname AND the same 40-bit
    // block) and unguessability. The /folder upload link is HMAC-signed
    // regardless — this block is defence-in-depth, not the access control.
    const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const bytes = new Uint8Array(5);
    try {
      crypto.getRandomValues(bytes);
    } catch {
      // No Web Crypto (extremely rare): seed from time + Math.random so refs stay
      // UNIQUE (what matters most here; the HMAC still gates the folder link).
      let seed = Date.now() >>> 0;
      for (let i = 0; i < bytes.length; i += 1) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        bytes[i] = (seed ^ Math.floor(Math.random() * 256)) & 0xff;
      }
    }
    // Bias-free 5-bit slicing: 5 bytes (40 bits) -> exactly 8 alphabet chars.
    let buffer = 0;
    let bitsLeft = 0;
    let code = '';
    for (let i = 0; i < bytes.length; i += 1) {
      buffer = (buffer << 8) | bytes[i];
      bitsLeft += 8;
      while (bitsLeft >= 5) {
        bitsLeft -= 5;
        code += ALPHABET[(buffer >>> bitsLeft) & 31];
      }
      buffer &= (1 << bitsLeft) - 1;
    }

    return `${prefix}-${code.slice(0, 4)}-${code.slice(4, 8)}`;
  },

  // Generates the reference once per form and caches it — getLeadReference()
  // draws fresh random bits every call, so callers must go through here to
  // reuse the same value everywhere (uploads, hidden fields, redirects).
  // Uploads need it before submit (fired on file-select), so the storage
  // folder and the Zoho record share one reference.
  ensureReference(form) {
    if (form?.submissionMeta?.uniqueId) return form.submissionMeta.uniqueId;
    const root = form?.root instanceof HTMLFormElement
      ? form.root
      : form?.root?.closest?.('form') || form?.root;
    const uniqueId = this.getLeadReference({ root });
    if (form) {
      form.submissionMeta = form.submissionMeta || {};
      form.submissionMeta.uniqueId = uniqueId;
    }
    return uniqueId;
  },

  getLastName(form) {
    return this.getFieldValue(form, ['last_name']);
  },

  setFields(form) {
    const root = form.root instanceof HTMLFormElement
      ? form.root
      : form.root?.closest?.('form') || form.root;
    if (!root || !(root instanceof HTMLFormElement)) {
      console.warn('[Suttons Attribution] setFields: no form element found.', { root });
      return null;
    }

    const storage = this.getStorage();
    const attribution = this.readAttribution(storage);

    // If storage read returned empty and we're in a browser, try capture() once
    if (!attribution.first_landing_url && typeof window !== 'undefined') {
      this.capture();
      const retry = this.readAttribution(storage);
      if (retry.first_landing_url) Object.assign(attribution, retry);
    }

    const uniqueId = this.ensureReference(form);
    const firstPage = attribution.first_page || attribution.first_landing_url || this.cleanUrl(window.location.href);
    const lastPage = this.cleanUrl(window.location.href);

    // CAPTURED fields, not derived ones — see the four kinds in SIMPLE.md.
    // Every value below comes from the browser or the stored session, so none of
    // it can be authored in the Designer or asserted from markup: it does not
    // exist until a real visit. These names are the Zapier contract just as much
    // as the gold_* ones, so renaming one silently stops attribution reaching
    // Zoho rather than throwing.
    formValues.setHidden(root, 'current_url', lastPage);
    formValues.setHidden(root, 'first_landing_url', firstPage);
    formValues.setHidden(root, 'first_page', firstPage);
    formValues.setHidden(root, 'last_page', lastPage);
    formValues.setHidden(root, 'referrer_url', this.cleanUrl(document.referrer));
    formConfig.attribution.utmParams.forEach((param) => {
      formValues.setHidden(root, param, attribution[param] || '');
    });
    formValues.setHidden(root, 'GCLID', attribution.gclid || '');
    formValues.setHidden(root, 'fbclid', attribution.fbclid || '');
    formValues.setHidden(root, 'unique_id', uniqueId);
    formValues.setHidden(root, 'lead_reference', uniqueId);
    formValues.setHidden(root, 'quote_url', this.getQuoteUrl({ root }, uniqueId));

    // Signed link to this enquiry's folder page — captured from the Worker's
    // upload response (the form can't build it; it's HMAC-signed server-side).
    // This is the single field mapped into one Zoho URL field for ALL
    // attachments (images, videos, PDFs). Read before submissionMeta is overwritten.
    const folderUrl = form?.submissionMeta?.folderUrl || '';
    // Always emit the field so downstream mappings have a stable contract. Empty
    // means this submission has no uploaded-file folder link yet.
    formValues.setHidden(root, 'all_files_url', folderUrl);

    const meta = { uniqueId, attribution, folderUrl };
    if (form) form.submissionMeta = meta;
    return meta;
  },

  pushDataLayer(form) {
    if (typeof window.dataLayer === 'undefined') return;
    if (form.hasPushedDataLayer) return;

    const storage = this.getStorage();
    const attribution = this.readAttribution(storage);
    const uniqueIdField = form.root.querySelector('[name="unique_id"], [name="lead_reference"]');
    const uniqueId = uniqueIdField ? uniqueIdField.value : '';
    const email = this.getFieldValue(form, ['email']);
    const phone = this.getPhoneValue(form);

    window.dataLayer.push({
      event: 'form_submission',
      form_name: form.key,
      form_category: formConfig.attribution.leadFormKeys.has(form.key) ? 'lead' : 'other',
      form_status: 'success',
      unique_id: uniqueId,
      email,
      phone,
      utm_source: attribution.utm_source || '',
      utm_medium: attribution.utm_medium || '',
      utm_campaign: attribution.utm_campaign || '',
      utm_term: attribution.utm_term || '',
      utm_content: attribution.utm_content || '',
      GCLID: attribution.gclid || '',
      fbclid: attribution.fbclid || '',
    });

    form.hasPushedDataLayer = true;
  },

  getQuoteUrl(form, leadReference) {
    const baseUrl = formConfig.attribution.quoteUrlFallbackPath || this.cleanUrl(window.location.href);
    const quoteUrl = new URL(baseUrl, window.location.origin);
    const params = quoteUrl.searchParams;

    this.setParam(params, 'firstName', this.getFieldValue(form, ['first_name']));
    this.setParam(params, 'lastName', this.getFieldValue(form, ['last_name']));
    this.setParam(params, 'email', this.getFieldValue(form, ['email']));
    this.setParam(params, 'phone', this.getPhoneValue(form));
    this.setParam(params, 'brand', this.getFieldValue(form, ['brand', 'watch_brand', 'jewellery_brand', 'handbag_brand', 'other_asset_types', 'asset_type', 'item_type', 'jewellery_type', 'handbag_type']));
    this.setParam(params, 'page', this.getPageLabel(form));
    this.setParam(params, 'ref', leadReference);
    this.setParam(params, 'step', formConfig.attribution.quoteUrlStep);

    return quoteUrl.href;
  },

  getFieldValue(form, names) {
    for (const name of names) {
      const values = formValues.get(form.root, name);
      const value = String(values[0] || '').trim();
      if (value) return value;
    }
    return '';
  },

  getPhoneValue(form) {
    const phone = this.getFieldValue(form, ['phone']);
    const countryCode = this.getFieldValue(form, ['phone_country_code']);
    return buildPhoneValue(phone, countryCode);
  },

  getPageLabel(form) {
    const heading = Array.from(document.querySelectorAll('h1')).find((element) => {
      if (element.closest('.w-form')) return false;
      return element.getClientRects().length > 0;
    });
    if (heading && heading.textContent.trim()) return heading.textContent.trim();

    return document.title || form.key;
  },

  setParam(params, name, value) {
    const cleanValue = String(value || '').trim();
    if (cleanValue) {
      params.set(name, cleanValue);
    }
  },

  redirectToThankYou(form) {
    if (!formConfig.successPages.enabled) return;

    const thankYouUrl = this.getThankYouUrl(form);
    if (!thankYouUrl) return;

    const target = new URL(thankYouUrl, window.location.origin);
    const uniqueIdField = form.root.querySelector('[name="unique_id"], [name="lead_reference"]');
    const uniqueId = uniqueIdField ? uniqueIdField.value : '';
    const values = {
      form: form.key,
      reference: uniqueId,
      enquiry_type: this.getFieldValue(form, ['enquiry_type']),
      asset_type: this.getFieldValue(form, ['asset_type']),
    };

    (formConfig.successPages.includeParams || Object.keys(values)).forEach((name) => {
      this.setParam(target.searchParams, name, values[name]);
    });

    // Client requirement: the redirect must carry Reference (capital R) for
    // tracking pixels (Ruler, GA, Google Ads, Meta), plus lowercase reference
    // and ref for internal success handling and quote links.
    if (uniqueId) {
      this.setParam(target.searchParams, 'Reference', uniqueId);
      this.setParam(target.searchParams, 'ref', uniqueId);
    }

    window.location.href = target.href;
  },

  storeSuccessSnapshot(form, meta) {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    const root = form?.root;
    if (!root) return null;

    const reference = meta?.uniqueId
      || root.querySelector('[name="unique_id"], [name="lead_reference"]')?.value
      || '';
    if (!reference) return null;

    const valueFor = (names) => this.getFieldValue(form, names);

    // Snapshot carries only: (a) what a TY page can render — `reference`, plus
    // the structural `form`/`enquiry_type`/`asset_type` keys `getSuccessData`
    // surfaces (see docs/developer/thank-you-outputs.md in the private repo);
    // and (b) `email`/`phone` for the `form_submission` dataLayer push, which
    // fires on TY load (`trackSuccess`) because a native POST races unload and
    // loses the pre-handoff push. `unique_id`/`form_category` derive on the TY
    // page from `reference`/`form`; UTM/gclid/fbclid come from `sr_attribution`
    // instead. All other PII (appointment/amount/contact_method/item_type/
    // brand/courier_*) is deliberately dropped.
    const snapshot = {
      reference,
      form: form.key,
      enquiry_type: valueFor(['enquiry_type']),
      asset_type: valueFor(['asset_type']),
      // Retained for the TY-page form_submission push (GTM enhanced
      // conversions). Not rendered by hydrateOutputs; cleared once the push fires.
      email: valueFor(['email']),
      phone: this.getPhoneValue(form),
    };

    const compact = Object.fromEntries(
      Object.entries(snapshot).filter(([, value]) => String(value || '').trim() !== '')
    );
    // TTL marker so a stale snapshot from an earlier submit can be expired on read.
    compact.savedAt = Date.now();

    try {
      window.sessionStorage.setItem('sr_form_success_latest', JSON.stringify(compact));
      window.sessionStorage.setItem(`sr_form_success_${reference}`, JSON.stringify(compact));
      return compact;
    } catch {
      return null;
    }
  },

  getThankYouUrl(form) {
    return form.root.getAttribute('data-form-thank-you') || '';
  },

  readAttribution(storage) {
    try {
      const raw = storage.getItem(formConfig.attribution.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Defensive sanitize on read: cleans any UTM value that was persisted
        // corrupted before this fix shipped, so no stale value can leak out.
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return sanitizeTrackingValues(parsed);
        console.warn('[Suttons Attribution] Corrupt attribution data in storage, resetting.');
      }
    } catch (e) {
      console.warn('[Suttons Attribution] Failed to parse attribution from storage:', e?.message);
    }
    // Cookie fallback
    try {
      const c = readCookie('sr_attribution');
      if (c) {
        const parsed = JSON.parse(c);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return sanitizeTrackingValues(parsed);
      }
    } catch (e) {
      console.warn('[Suttons Attribution] Failed to parse attribution from cookie:', e?.message);
    }
    return {};
  },

  writeAttribution(storage, data) {
    let storageOk = false;
    try {
      storage.setItem(formConfig.attribution.storageKey, JSON.stringify(data));
      storageOk = true;
    } catch (e) {
      console.warn('[Suttons Attribution] Storage write failed:', e?.message || e);
    }
    // Always mirror critical keys to the cookie as a resilient secondary store.
    try {
      const cookiePayload = {
        first_landing_url: data.first_landing_url,
        first_page: data.first_page,
        utm_source: data.utm_source,
        utm_medium: data.utm_medium,
        utm_campaign: data.utm_campaign,
        utm_term: data.utm_term,
        utm_content: data.utm_content,
        gclid: data.gclid,
        fbclid: data.fbclid,
        captured_at: data.captured_at,
      };
      writeCookie('sr_attribution', JSON.stringify(cookiePayload), 30);
    } catch {}
    return storageOk;
  },

  cleanUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url, window.location.origin);
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch (e) {
      return '';
    }
  },

  getStorage() {
    try {
      if (window.localStorage) {
        const testKey = '__storage_test__';
        window.localStorage.setItem(testKey, testKey);
        window.localStorage.removeItem(testKey);
        return window.localStorage;
      }
    } catch (e) {}
    return memoryStorage;
  },
};

// THANK-YOU PAGE HYDRATION AND THE SUCCESS dataLayer PUSH
// ----------------------------------------------------------------------------
