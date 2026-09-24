// Redirect-mode forms: home-hero, loan, fulfilment-finder.
//
// These do not submit to Webflow. They collect answers and navigate, carrying
// the answers as URL params for the destination form to prefill.

import { SELECTORS, formConfig } from './shared.js';
import { formDom } from './dom.js';
import { formValues } from './values.js';
import { formAttribution } from './attribution.js';
import { formParams } from './navigation.js';

export const formRedirect = {
  isRedirect(form) {
    return (form.root.getAttribute('data-form-mode') || '').trim().toLowerCase() === 'redirect';
  },

  getTargetUrl(form) {
    const explicitUrl = form.root.getAttribute('data-form-redirect-url');
    const actionUrl = form.root.getAttribute('action');
    return explicitUrl || actionUrl || window.location.href;
  },

  getTargetFormKey(form) {
    return form.root.getAttribute('data-form-redirect-form') || form.key;
  },

  // Pure computation of the redirect destination URL, separated from
  // side-effecting navigation so callers (including tests) can assert on the
  // URL without triggering jsdom navigation.
  computeTargetUrl(form, presetValues, attributionMeta) {
    const target = new URL(this.getTargetUrl(form), window.location.origin);
    const targetFormKey = this.getTargetFormKey(form);
    const targetForm = { key: targetFormKey };

    // Attribution and lead_reference must be present: the client needs a
    // stable unique ID on every submission and thank-you redirect for
    // tracking pixels.
    let uniqueId = attributionMeta?.uniqueId || form?.submissionMeta?.uniqueId || '';
    if (!uniqueId) {
      formAttribution.capture();
      const meta = formAttribution.setFields(form);
      if (meta && meta.uniqueId) uniqueId = meta.uniqueId;
    }

    let attribution = {};
    if (attributionMeta && attributionMeta.attribution) {
      attribution = attributionMeta.attribution;
    } else {
      try {
        attribution = formAttribution.readAttribution(formAttribution.getStorage());
      } catch {}
    }

    (presetValues || this.getRedirectValues(form)).forEach(({ name, values }) => {
      const paramName = formParams.getParamName(targetForm, name);
      target.searchParams.delete(paramName);
      values.forEach((value) => {
        const fields = Array.from(form.root.querySelectorAll(formDom.getNameSelector(name)));
        const resolved = fields.length
          ? formParams.resolveFieldValue(fields, value)
          : value;

        target.searchParams.append(paramName, resolved);
      });
    });

    // Carry attribution, lead reference and ref for thank-you tracking pixels
    // and quote links.
    const clean = formAttribution.cleanUrl.bind(formAttribution);

    const trackingToSend = {
      unique_id: uniqueId,
      lead_reference: uniqueId,
      ref: uniqueId,
      first_landing_url: attribution.first_landing_url || attribution.first_page || '',
      first_page: attribution.first_page || attribution.first_landing_url || '',
      last_page: clean(window.location.href),
      referrer_url: clean(document.referrer),
      utm_source: attribution.utm_source || '',
      utm_medium: attribution.utm_medium || '',
      utm_campaign: attribution.utm_campaign || '',
      utm_term: attribution.utm_term || '',
      utm_content: attribution.utm_content || '',
      GCLID: attribution.gclid || '',
      fbclid: attribution.fbclid || '',
    };

    Object.keys(trackingToSend).forEach((key) => {
      const val = trackingToSend[key];
      if (!val) return;
      const paramName = formParams.getParamName(targetForm, key);
      target.searchParams.set(paramName, val);
    });

    return target.href;
  },

  submit(form, presetValues, attributionMeta) {
    const href = this.computeTargetUrl(form, presetValues, attributionMeta);
    window.location.href = href;
  },

  getRedirectValues(form) {
    const groups = new Map();

    const addValues = (fieldKey, values) => {
      const cleanValues = values
        .map((value) => String(value).trim())
        .filter(Boolean);

      if (!cleanValues.length) return;

      if (!groups.has(fieldKey)) {
        groups.set(fieldKey, {
          name: fieldKey,
          values: [],
        });
      }

      const bucket = groups.get(fieldKey).values;
      cleanValues.forEach((value) => {
        if (!bucket.includes(value)) bucket.push(value);
      });
    };

    const consumedControls = new Set();

    Array.from(form.root.elements).forEach((control) => {
      if (!this.shouldIncludeControl(control)) return;
      consumedControls.add(control);
      addValues(this.getControlFieldKey(control), formValues.getControlValues(control));
    });

    // The pass above already emits every included control (keyed by
    // getControlFieldKey, preferring data-form-field). Add field groups only
    // for inputs not already consumed, so a value isn't emitted twice under
    // both keys.
    formParams.getFieldGroups(form).forEach((group) => {
      const fields = group.fields.filter((field) => !consumedControls.has(field));
      if (!fields.length) return;
      addValues(group.fieldKey, formParams.getGroupValues(fields));
    });

    return Array.from(groups.values());
  },

  getControlFieldKey(control) {
    const wrapper = control.closest(SELECTORS.field);
    const fieldKey = wrapper?.getAttribute('data-form-field');
    if (fieldKey) return fieldKey;

    return control.name;
  },

  shouldIncludeControl(control) {
    if (!control || !control.name) return false;
    if (formValues.shouldOmitControl(control)) return false;
    if (control.matches('button')) return false;
    if (['button', 'submit', 'reset'].includes(control.type)) return false;
    if (control.type === 'file') return false;
    if (formConfig.params.excludedFields.has(this.getControlFieldKey(control))) return false;

    return true;
  },
};
