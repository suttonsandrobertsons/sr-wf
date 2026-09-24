// The thank-you page: hydrating it from the submission, and the dataLayer push.
//
// Reads a sessionStorage snapshot written at submit, which expires after 30
// minutes so a stale tab cannot show someone else's quote.

import { formConfig } from './shared.js';
import { formAttribution, SUCCESS_SNAPSHOT_MAX_AGE_MS } from './attribution.js';

export const formSuccessPage = {
  hasScrolled: false,

  outputSelector: '[data-form-success-output]',
  fieldSelector: '[data-form-success-field]',

  shouldScrollToTop() {
    if (typeof window === 'undefined') return false;

    const params = new URLSearchParams(window.location.search || '');
    const hasReference = params.has('Reference') || params.has('reference') || params.has('ref');
    const looksLikeSuccessPath = /thank|success|submission/i.test(window.location.pathname || '');
    const hasFormSuccessParams = params.has('form') && (params.has('Reference') || params.has('reference'));

    return hasReference && (looksLikeSuccessPath || hasFormSuccessParams);
  },

  scrollToTopIfNeeded() {
    if (this.hasScrolled || !this.shouldScrollToTop()) return;
    this.hasScrolled = true;

    try {
      if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    } catch {}

    const scrollTop = () => {
      try {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      } catch {
        window.scrollTo(0, 0);
      }
    };

    scrollTop();
    window.requestAnimationFrame?.(scrollTop);
  },

  hydrateOutputs(scope = document) {
    const outputs = Array.from(scope.querySelectorAll(this.outputSelector));
    if (!outputs.length) return;

    const data = this.getSuccessData();
    outputs.forEach((output) => {
      const key = output.getAttribute('data-form-success-output');
      const value = this.formatValue(data[key]);
      const row = output.closest(this.fieldSelector);

      if (value) {
        output.textContent = value;
        row?.removeAttribute('hidden');
        row?.removeAttribute('aria-hidden');
        row?.style?.removeProperty('display');
        return;
      }

      output.textContent = '';
      if (row) {
        row.hidden = true;
        row.setAttribute('aria-hidden', 'true');
        row.style?.setProperty('display', 'none');
      }
    });

    // Not cleared here: trackSuccess runs right after hydrate in boot() and
    // needs the snapshot alive to fire the `form_submission` push. It clears
    // the snapshot only after the push has read it.
  },

  // Fires the authoritative `form_submission` push from the stored snapshot,
  // since a native POST can unload the page before an earlier push is sent.
  // Matches pushDataLayer's event shape.
  pushedReferences: new Set(),
  hasPushedNoRef: false,

  trackSuccess(scope = document) {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search || '');
    const reference = params.get('Reference') || params.get('reference') || params.get('ref') || '';
    // Read the raw snapshot (holds email/phone) — reference-keyed first, else _latest.
    const snapshot = this.readStoredSnapshot(reference);
    if (!snapshot || Object.keys(snapshot).length === 0) return;

    const pushed = this.pushSuccessEvent(snapshot);
    // Ordering guarantee: clear only after the push has read the snapshot.
    if (pushed) this.clearStoredSnapshot(snapshot.reference || reference);
  },

  pushSuccessEvent(snapshot) {
    if (typeof window === 'undefined' || typeof window.dataLayer === 'undefined') return false;

    const reference = snapshot.reference || '';
    // Dedup: never push twice for the same reference (re-init / consent refire).
    if (reference) {
      if (this.pushedReferences.has(reference)) return false;
    } else if (this.hasPushedNoRef) {
      return false;
    }

    const attribution = formAttribution.readAttribution(formAttribution.getStorage());
    const formKey = snapshot.form || '';

    window.dataLayer.push({
      event: 'form_submission',
      form_name: formKey,
      form_category: formConfig.attribution.leadFormKeys.has(formKey) ? 'lead' : 'other',
      form_status: 'success',
      unique_id: reference,
      email: snapshot.email || '',
      phone: snapshot.phone || '',
      utm_source: attribution.utm_source || '',
      utm_medium: attribution.utm_medium || '',
      utm_campaign: attribution.utm_campaign || '',
      utm_term: attribution.utm_term || '',
      utm_content: attribution.utm_content || '',
      GCLID: attribution.gclid || '',
      fbclid: attribution.fbclid || '',
    });

    if (reference) this.pushedReferences.add(reference);
    else this.hasPushedNoRef = true;
    return true;
  },

  getSuccessData() {
    const params = new URLSearchParams(window.location.search || '');
    const reference = params.get('Reference') || params.get('reference') || params.get('ref') || '';
    const stored = this.readStoredSnapshot(reference);

    // Only the render-allowed structural keys. email/phone (for the
    // form_submission push, see storeSuccessSnapshot) must never render via a
    // TY output hook, so they're excluded here — trackSuccess reads them
    // directly off the snapshot.
    return {
      reference: reference || stored.reference || '',
      form: params.get('form') || stored.form || '',
      enquiry_type: params.get('enquiry_type') || stored.enquiry_type || '',
      asset_type: params.get('asset_type') || stored.asset_type || '',
    };
  },

  readStoredSnapshot(reference) {
    if (typeof window === 'undefined' || !window.sessionStorage) return {};
    const keys = [
      reference ? `sr_form_success_${reference}` : '',
      'sr_form_success_latest',
    ].filter(Boolean);

    for (const key of keys) {
      try {
        const raw = window.sessionStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          // TTL: ignore (and clear) snapshots older than the max age so stale
          // data from an earlier submit can't hydrate a later TY view.
          const savedAt = Number(parsed.savedAt || 0);
          if (savedAt && Date.now() - savedAt > SUCCESS_SNAPSHOT_MAX_AGE_MS) {
            try { window.sessionStorage.removeItem(key); } catch {}
            continue;
          }
          return parsed;
        }
      } catch {}
    }

    return {};
  },

  // Remove the reference-keyed snapshot and the unscoped _latest fallback once
  // it has been consumed by trackSuccess.
  clearStoredSnapshot(reference) {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    const keys = [
      reference ? `sr_form_success_${reference}` : '',
      'sr_form_success_latest',
    ].filter(Boolean);
    keys.forEach((key) => {
      try { window.sessionStorage.removeItem(key); } catch {}
    });
  },

  formatValue(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).join(', ');
    return String(value || '').trim();
  },
};
