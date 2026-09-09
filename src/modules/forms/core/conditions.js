import { SELECTORS, formConfig, buildPhoneValue } from './shared.js';
import { formLogger, formDom } from './dom.js';
import { formValues, formFields } from './fields.js';
import { formChoices } from './choices.js';
import { getFormApp } from './lazy-app.js';

// SUBMIT-TIME AND URL-TIME CONCERNS
// ============================================================================
// The filename names only the first export. This file holds six unrelated
// concerns. Check this map before searching further:
//
//   formConditions   show-if / hide-if evaluation
//   formSteps        multi-step navigation and step validation
//   formRedirect     redirect-mode forms (home-hero, loan, fulfilment-finder)
//   formAttribution  UTM capture, the lead reference, and `quote_url`
//   formSuccessPage  thank-you hydration and the dataLayer push
//   formParams       URL-param prefill and URL state sync
//
// `brand` appears here twice — in formAttribution's quote_url coalescing and
// in formParams' prefill — and neither is the combined `brands` field built by
// formFieldGroups in fields.js. This has repeatedly been mistaken for a
// derived field; see docs/developer/webflow-authoring.md in the private repository.
// ============================================================================

// CONDITIONAL LOGIC (SHOW-IF / HIDE-IF)
// ----------------------------------------------------------------------------
// `hide-if` is fully supported but has no known use in the Designer — it was
// added for symmetry with `show-if`. Do not assume a rule uses it.
export const formConditions = {
  _synthesizeRule(element, groupAttr, valueAttr) {
    const group = (element.getAttribute(groupAttr) || '').trim();
    if (!group) return null;
    const value = (element.getAttribute(valueAttr) || '').trim();
    return value ? `${group} = ${value}` : group;
  },

  render(form) {
    if (form && !form.scope && !form.root && form.querySelectorAll) {
      form = { scope: form, root: form, steps: form.steps || [] };
    }
    const scope = form.scope || form.root || form;
    scope.querySelectorAll(SELECTORS.conditional).forEach((element) => {
      const showRule = element.getAttribute('data-form-show-if')
        || this._synthesizeRule(element, 'data-form-show-if-group', 'data-form-show-if-value');
      const hideRule = element.getAttribute('data-form-hide-if')
        || this._synthesizeRule(element, 'data-form-hide-if-group', 'data-form-hide-if-value');
      const hideAnyRule = element.getAttribute('data-form-hide-if-any')
        || this._synthesizeRule(element, 'data-form-hide-if-any-group', 'data-form-hide-if-any-value');

      const isStepHidden = formDom.isStepHidden(element);
      const skipInlineHide = formDom.skipsInlineConditionHide(element);
      const shouldShow = this.shouldShow(form, showRule, hideRule, hideAnyRule, {
        partialShowMatch: skipInlineHide && this.usesPartialShowMatching(element),
      });
      const isConditionHidden = !shouldShow;

      formDom.setState(element, 'condition-hidden', isConditionHidden);

      if (skipInlineHide) {
        formDom.setState(element, 'hidden', isStepHidden);
        formDom.setRendered(element, !isStepHidden);
      } else {
        formDom.setState(element, 'hidden', isConditionHidden || isStepHidden);
        formDom.setRendered(element, !isConditionHidden && !isStepHidden);
      }

      element.setAttribute('aria-hidden', isConditionHidden ? 'true' : 'false');
    });
  },

  shouldShow(form, showRule, hideRule, hideAnyRule, options = {}) {
    const cleanShowRule = (showRule || '').trim();
    const cleanHideRule = (hideRule || '').trim();
    const cleanHideAnyRule = (hideAnyRule || '').trim();

    if (cleanShowRule) {
      if (options.partialShowMatch) {
        return this.matchesPartialList(form, cleanShowRule);
      }
      return this.matchesList(form, cleanShowRule);
    }

    if (cleanHideAnyRule) {
      return !this.matchesAny(form, cleanHideAnyRule);
    }

    if (cleanHideRule) {
      return !this.matchesList(form, cleanHideRule);
    }

    return true;
  },

  usesPartialShowMatching(element) {
    return Boolean(element?.matches?.('[data-form-partial-match], .product-card-wrap, .product-card'));
  },

  matchesList(form, ruleList) {
    return this.getRules(ruleList).every((rule) => {
      return this.matches(form, rule);
    });
  },

  matchesPartialList(form, ruleList) {
    const activeRules = this.getRules(ruleList).filter((rule) => {
      const fieldName = this.getRuleFieldName(rule);
      if (!fieldName) return true;
      return this.getFieldValues(form, fieldName).some(Boolean);
    });

    if (!activeRules.length) return true;

    return activeRules.every((rule) => {
      return this.matches(form, rule);
    });
  },

  matchesAny(form, ruleList) {
    return this.getRules(ruleList).some((rule) => {
      return this.matches(form, rule);
    });
  },

  getRules(ruleList) {
    return String(ruleList || '')
      .split(';')
      .flatMap((segment) => {
        // A plain split on "," breaks a value containing a comma (e.g. "Hello,
        // world"). Split only where the comma starts a new rule (a negation,
        // or a field name plus operator) — see getRules tests for the cases
        // that must not split.
        return segment.split(/,(?=\s*(?:![a-zA-Z_][a-zA-Z0-9_-]*\s*(?:,|$)|[a-zA-Z_][a-zA-Z0-9_-]*\s*(?:>=|<=|!=|=|>|<)))/);
      })
      .map((rule) => rule.trim())
      .filter(Boolean);
  },

  getRuleFieldName(rule) {
    const cleanRule = String(rule || '').trim();
    if (!cleanRule) return null;
    if (cleanRule.startsWith('!')) return cleanRule.slice(1).trim();
    const match = cleanRule.match(/^([^!<>=]+?)\s*(?:>=|<=|!=|=|>|<)/);
    return (match ? match[1] : cleanRule).trim();
  },

  getFieldValues(form, fieldName) {
    const virtual = this.getVirtualFieldValues(form, fieldName);
    if (virtual !== null) return virtual;
    return formValues.get(form.root, fieldName);
  },

  getVirtualFieldValues(form, fieldName) {
    const name = String(fieldName || '').trim().toLowerCase();
    if (name !== 'step' && name !== 'steps') return null;
    if (!form?.steps?.length) return [];
    return [String(formSteps.getCurrentNumber(form))];
  },

  matches(form, rule) {
    if (!rule) return true;

    if (rule.startsWith('!')) {
      return !this.getFieldValues(form, rule.slice(1).trim()).some(Boolean);
    }

    const match = rule.match(/^([^!<>=]+?)\s*(>=|<=|!=|=|>|<)\s*(.*)$/);
    if (!match) {
      return this.getFieldValues(form, rule).some(Boolean);
    }

    return this.matchesRule(form, {
      fieldName: match[1].trim(),
      operator: match[2],
      expected: match[3].trim(),
    });
  },

  matchesRule(form, rule) {
    const values = this.getFieldValues(form, rule.fieldName);

    if (rule.operator === '=') {
      return this.matchesEquality(form, rule, values, false);
    }

    if (rule.operator === '!=') {
      return this.matchesEquality(form, rule, values, true);
    }

    return this.matchesNumberRule(values, rule.operator, rule.expected);
  },

  matchesEquality(form, rule, values, negate) {
    const expected = rule.expected.trim();
    if (values.includes(expected)) {
      return !negate;
    }

    // Uppercase OR only — lowercase "or" appears inside human labels such as
    // "Request Home Visit or Regional Office Appointment".
    const orParts = expected.split(/\s+OR\s+/);
    if (orParts.length > 1 && orParts.some((p) => /[<>=]/.test(p))) {
      const result = orParts.some((part) => {
        const subMatch = part.match(/^([^!<>=]+?)\s*(>=|<=|!=|=|>|<)\s*(.*)$/);
        if (!subMatch) return values.includes(part.trim());
        return this.matchesRule(form, {
          fieldName: subMatch[1].trim(),
          operator: subMatch[2],
          expected: subMatch[3].trim(),
        });
      });
      return negate ? !result : result;
    }

    const orValues = expected.replace(/\s+OR\s+/g, '|').split('|');
    const result = orValues.some((expectedValue) => {
      return values.includes(expectedValue.trim());
    });
    return negate ? !result : result;
  },

  matchesNumberRule(values, operator, expected) {
    const expectedNumber = formValues.parseMoney(expected);

    return values.some((value) => {
      const actualNumber = formValues.parseMoney(value);

      if (Number.isNaN(actualNumber) || Number.isNaN(expectedNumber)) return false;
      if (operator === '>') return actualNumber > expectedNumber;
      if (operator === '>=') return actualNumber >= expectedNumber;
      if (operator === '<') return actualNumber < expectedNumber;
      if (operator === '<=') return actualNumber <= expectedNumber;

      return false;
    });
  },
};

// ============================================================================
// STEPS NAVIGATION
// ============================================================================
export const formSteps = {
  goBy(form, direction) {
    if (!form.steps.length) {
      throw new Error('Step action used, but no [data-form-step] elements were found.');
    }

    getFormApp().refresh(form);

    const availableSteps = this.getAvailableSteps(form);
    const currentStep = form.steps[form.stepIndex];
    const currentIndex = availableSteps.indexOf(currentStep);

    formLogger.log(form, 'Step goBy.', {
      direction: direction > 0 ? 'next' : 'prev',
      currentIndex,
      currentStepNumber: this.getCurrentNumber(form),
      availableSteps: availableSteps.length,
      totalSteps: form.steps.length,
    });

    if (!availableSteps.length) {
      throw new Error('No available [data-form-step] elements were found. Check your data-form-show-if rules.');
    }

    if (direction > 0 && !this.validateCurrent(form)) {
      formLogger.warn(form, 'Step change blocked by validation.', {
        currentStep: this.getCurrentNumber(form),
      });
      return;
    }

    const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextAvailableIndex = safeCurrentIndex + direction;

    if (nextAvailableIndex < 0 || nextAvailableIndex >= availableSteps.length) {
      formLogger.warn(form, 'Step action ignored because the target step is out of range.', {
        requestedStep: nextAvailableIndex + 1,
        totalSteps: availableSteps.length,
      });
      return;
    }

    const nextStep = availableSteps[nextAvailableIndex];
    form.stepIndex = form.steps.indexOf(nextStep);
    getFormApp().refresh(form);
    formParams.update(form);
    formSteps.scrollToForm(form);

    formLogger.log(form, 'Step changed.', {
      step: this.getCurrentNumber(form),
      totalSteps: availableSteps.length,
    });
  },

  render(form) {
    const availableSteps = this.getAvailableSteps(form);

    if (!availableSteps.length) {
      throw new Error('No available [data-form-step] elements were found. Check your data-form-show-if rules.');
    }

    this.normalize(form, availableSteps);

    const currentStep = form.steps[form.stepIndex];

    form.steps.forEach((step) => {
      const isAvailable = availableSteps.includes(step);
      const isActive = isAvailable && step === currentStep;
      const isConditionHidden = formDom.isConditionHidden(step);
      const activeElement = document.activeElement;

      if (!isActive && activeElement && step.contains(activeElement)) {
        activeElement.blur?.();
      }

      formDom.setState(step, 'active', isActive);
      formDom.setState(step, 'step-hidden', !isActive);
      formDom.setState(step, 'hidden', !isActive || isConditionHidden);
      formDom.setRendered(step, isActive && !isConditionHidden);
      step.setAttribute('aria-hidden', isActive ? 'false' : 'true');

      if (isActive) {
        step.removeAttribute('inert');
      } else {
        step.setAttribute('inert', '');
      }
    });

    this.renderCount(form, availableSteps);
  },

  scrollToForm(form) {
    const formElement = form.root.closest('[data-form]');
    if (!formElement) return;

    const prefersReducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const activeStep = form.steps?.[form.stepIndex];
        const targetElement = activeStep || formElement;
        const rect = targetElement.getBoundingClientRect();
        // Sticky-header clearance so the step heading isn't tucked under it.
        const offset = 20;
        const targetTop = Math.max(window.pageYOffset + rect.top - offset, 0);

        // Always realign to the top of the step or form — a plain distance
        // check, so it corrects both an under-scroll and an over-scroll.
        if (Math.abs(window.pageYOffset - targetTop) < 2) return;

        try {
          window.scrollTo({
            top: targetTop,
            left: 0,
            behavior: prefersReducedMotion ? 'auto' : 'smooth',
          });
        } catch {
          window.scrollTo(0, targetTop);
        }
      });
    });
  },

  normalize(form, availableSteps) {
    const currentStep = form.steps[form.stepIndex];
    if (availableSteps.includes(currentStep)) return;

    const nextStep = this.getNearestAvailableStep(form, availableSteps);
    form.stepIndex = form.steps.indexOf(nextStep);
  },

  getNearestAvailableStep(form, availableSteps) {
    const currentIndex = form.stepIndex;
    const after = availableSteps.find((step) => {
      return form.steps.indexOf(step) >= currentIndex;
    });

    if (after) return after;
    return availableSteps[availableSteps.length - 1];
  },

  getAvailableSteps(form) {
    return form.steps.filter((step) => {
      return !formDom.isConditionHidden(step);
    });
  },

  getCurrentNumber(form) {
    const availableSteps = this.getAvailableSteps(form);
    const currentStep = form.steps[form.stepIndex];
    const currentIndex = availableSteps.indexOf(currentStep);

    // When the current step is out of range or condition-hidden, fall back to
    // the first available step (1) rather than leaking "Step 0" into the UI
    // and step= condition matching.
    return currentIndex >= 0 ? currentIndex + 1 : (availableSteps.length ? 1 : 0);
  },

  renderCount(form, availableSteps) {
    formDom.setText(form.root, SELECTORS.stepCurrent, String(this.getCurrentNumber(form)));
    formDom.setText(form.root, SELECTORS.stepTotal, String(availableSteps.length));
  },

  validateCurrent(form) {
    const step = form.steps[form.stepIndex];
    if (!step) {
      throw new Error('Current form step does not exist.');
    }

    if (formDom.isConditionHidden(step)) return true;
    return formFields.validateScope(form, step);
  },

  validateAvailable(form) {
    return this.getAvailableSteps(form).every((step) => {
      return formFields.validateScope(form, step);
    });
  },

  // Deep-link guard: returns the furthest step index the customer may land on
  // (e.g. from ?step=2). Clamps to the earliest step with unmet required
  // fields — this closes the bypass where a lead jumps to ?step=2 and submits
  // with an empty step 1. Redirect-mode forms (home-hero, loan,
  // fulfilment-finder) legitimately deep-link to step 2 with step-1 contact
  // fields prefilled, so satisfied prefills keep the customer on the requested step.
  clampToValidPriorSteps(form, requestedIndex) {
    if (requestedIndex <= 0) return requestedIndex;

    const entryIndex = form.stepIndex;

    for (let index = 0; index < requestedIndex; index += 1) {
      const step = form.steps[index];
      if (!step) continue;

      // Evaluate each prior step in its own active context so conditions and
      // validation see the correct step-visibility state.
      form.stepIndex = index;
      getFormApp().refresh(form);

      if (formDom.isConditionHidden(step)) continue;

      if (!formFields.validateScope(form, step)) {
        getFormApp().refresh(form);
        return index;
      }
    }

    form.stepIndex = entryIndex;
    getFormApp().refresh(form);
    return requestedIndex;
  },

  validateAvailableAndReveal(form) {
    const availableSteps = this.getAvailableSteps(form);
    const entryStepIndex = form.stepIndex;

    for (const step of availableSteps) {
      form.stepIndex = form.steps.indexOf(step);
      getFormApp().refresh(form);

      if (!formFields.validateScope(form, step)) {
        formParams.update(form);
        formLogger.warn(form, 'Moved to invalid step.', {
          step: this.getCurrentNumber(form),
        });
        return false;
      }
    }

    // Validation is not navigation: restore the step the customer was on
    // before the scan (the loop left stepIndex on the last available step).
    form.stepIndex = entryStepIndex;
    getFormApp().refresh(form);

    return true;
  },
};

// REDIRECT-MODE FORMS
// ----------------------------------------------------------------------------
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
const SUCCESS_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

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
  // since a native POST races unload and the pre-handoff push doesn't
  // survive. Matches pushDataLayer's event shape.
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

// ============================================================================
// URL-PARAM PREFILL AND URL STATE SYNCHRONISATION
// ============================================================================
// This is the third value-matching regime: lowercased, with an alias table, and
// applied only when prefilling from query params — never on submit. The other
// two are normalizeSlug (gold.js) and exact/case-sensitive (matchesEquality).
// ============================================================================
const WRAPPED_HISTORY_FLAG = Symbol.for('suttons.forms.wrappedHistoryMethod');

export const formParams = {
  isWatching: false,
  isWriting: false,

  watch() {
    if (!formConfig.params.enabled || !formConfig.params.watch || this.isWatching) return;

    this.isWatching = true;

    window.addEventListener('popstate', () => {
      this.handleLocationChange();
    });

    this.wrapHistoryMethod('pushState');
    this.wrapHistoryMethod('replaceState');
  },

  wrapHistoryMethod(methodName) {
    const originalMethod = window.history[methodName];
    const params = this;

    // Guard against wrapping twice (e.g. repeated watch() across re-inits),
    // which would stack handlers and fire handleLocationChange multiple times.
    if (originalMethod && originalMethod[WRAPPED_HISTORY_FLAG]) return;

    const wrappedHistoryMethod = function wrappedHistoryMethod() {
      const result = originalMethod.apply(this, arguments);
      params.handleLocationChange();
      return result;
    };
    wrappedHistoryMethod[WRAPPED_HISTORY_FLAG] = true;

    window.history[methodName] = wrappedHistoryMethod;
  },

  handleLocationChange() {
    if (this.isWriting) return;
    getFormApp().refreshAll();
  },

  hydrate(form) {
    if (!formConfig.params.enabled) return;

    const params = new URLSearchParams(window.location.search);

    this.hydrateQuoteParams(form, params);

    this.getFieldGroups(form).forEach((group) => {
      const values = this.getParamNames(form, group.fieldKey)
        .flatMap((paramName) => params.getAll(paramName))
        .filter((v) => v.trim() !== '');
      if (!values.length) return;

      form.syncedFieldKeys.add(group.fieldKey);

      const resolvedValues = values
        .map((value) => this.resolveFieldValue(group.fields, value))
        .filter((value, index, list) => value && list.indexOf(value) === index);

      if (!resolvedValues.length) return;

      this.setGroupValues(group.fields, resolvedValues);
    });

  },

  hydrateQuoteParams(form, params) {
    const quoteKeys = ['firstName', 'lastName', 'email', 'phone', 'brand', 'step'];
    const hasQuoteParams = quoteKeys.some((key) => params.has(key));
    if (!hasQuoteParams) return;

    this.setFirstMatchingField(form, ['first_name'], params.get('firstName'));
    this.setFirstMatchingField(form, ['last_name'], params.get('lastName'));
    this.setFirstMatchingField(form, ['email'], params.get('email'));
    this.setPhoneFromQuoteParam(form, params.getAll('phone'));
    this.setBrandFromQuoteParam(form, params.get('brand'));
    this.setStepFromQuoteParam(form, params.get('step'));
  },

  setPhoneFromQuoteParam(form, rawValues) {
    const cleanValue = (Array.isArray(rawValues) ? rawValues : [rawValues])
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .join('');

    if (!cleanValue) return;

    const countryField = this.findFirstField(form, ['phone_country_code']);
    const phoneField = this.findFirstField(form, ['phone']);
    if (!phoneField) return;

    if (!countryField || !cleanValue.startsWith('+')) {
      this.setFieldGroupValue(form, phoneField.name, cleanValue);
      return;
    }

    const countryOptions = Array.from(countryField.options || [])
      .map((option) => option.value)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const countryCode = countryOptions.find((optionValue) => cleanValue.startsWith(optionValue) && cleanValue.length > optionValue.length);

    if (!countryCode) {
      this.setFieldGroupValue(form, phoneField.name, cleanValue);
      return;
    }

    this.setFieldGroupValue(form, countryField.name, countryCode);
    this.setFieldGroupValue(form, phoneField.name, cleanValue.slice(countryCode.length));
  },

  setBrandFromQuoteParam(form, value) {
    const cleanValue = String(value || '').trim();
    if (!cleanValue) return;

    const assetField = this.findFirstField(form, ['asset_type', 'item_type', 'brand']);
    if (assetField && this.hasOptionOrChoiceValue(form, assetField.name, cleanValue)) {
      this.setFieldGroupValue(form, assetField.name, cleanValue);
      return;
    }

    this.setFirstMatchingField(form, [
      'watch_brand',
      'jewellery_brand',
      'handbag_brand',
      'jewellery_type',
      'handbag_type',
      'brand',
      'asset_type',
      'item_type',
    ], cleanValue);
  },

  setStepFromQuoteParam(form, value) {
    if (!form.steps.length) return;

    const stepNumber = parseInt(value, 10);
    if (!Number.isFinite(stepNumber) || stepNumber < 1) return;

    const requestedIndex = Math.min(stepNumber - 1, form.steps.length - 1);

    // clampToValidPriorSteps enforces the step-1 bypass guard here.
    form.stepIndex = formSteps.clampToValidPriorSteps(form, requestedIndex);
  },

  setFirstMatchingField(form, names, value) {
    const field = this.findFirstField(form, names);
    if (!field) return false;
    return this.setFieldGroupValue(form, field.name, value);
  },

  findFirstField(form, names) {
    const selector = names.map((name) => formDom.getNameSelector(name)).join(',');
    return form.root.querySelector(selector);
  },

  hasOptionOrChoiceValue(form, fieldName, value) {
    const cleanValue = String(value || '').trim().toLowerCase();
    if (!cleanValue) return false;

    return Array.from(form.root.querySelectorAll(formDom.getNameSelector(fieldName))).some((field) => {
      if (formValues.isChoiceField(field)) {
        return String(field.value || '').trim().toLowerCase() === cleanValue;
      }

      if (field.tagName === 'SELECT') {
        return Array.from(field.options).some((option) => {
          return String(option.value || '').trim().toLowerCase() === cleanValue;
        });
      }

      return true;
    });
  },

  setFieldGroupValue(form, fieldName, value) {
    const cleanValue = String(value || '').trim();
    if (!cleanValue) return false;

    const fields = Array.from(form.root.querySelectorAll(formDom.getNameSelector(fieldName)));
    if (!fields.length) return false;

    const resolvedValue = this.resolveFieldValue(fields, cleanValue);
    this.setGroupValues(fields, [resolvedValue]);
    fields.forEach((field) => {
      const isScalar = !formValues.isChoiceField(field) && !(field.tagName === 'SELECT' && field.multiple);
      if (isScalar) return;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return true;
  },

  normalizeParamValue(value) {
    const lower = String(value || '').trim().toLowerCase();
    if (!lower) return '';

    const aliases = {
      watches: 'watch',
      watch: 'watch',
      jewellery: 'jewellery',
      jewelry: 'jewellery',
      gold: 'gold',
      silver: 'silver',
      handbags: 'handbag',
      handbag: 'handbag',
      other: 'other',
      sell: 'sell',
      sale: 'sell',
      loan: 'loan',
      consign: 'consign',
      consign_for_sale: 'consign',
      unsure: 'unsure',
    };

    return aliases[lower] || lower;
  },

  resolveFieldValue(fields, value) {
    const cleanValue = String(value || '').trim();
    if (!cleanValue) return '';

    const normalized = this.normalizeParamValue(cleanValue);
    const lowerValue = cleanValue.toLowerCase();

    for (const field of fields) {
      const fieldValue = String(field.value || '').trim();
      const fieldNormalized = this.normalizeParamValue(fieldValue);

      if (formValues.isChoiceField(field)) {
        if (
          fieldNormalized === normalized ||
          fieldValue.toLowerCase() === lowerValue
        ) {
          return field.value;
        }
        continue;
      }

      if (field.tagName === 'SELECT') {
        const option = Array.from(field.options).find((item) => {
          const optionValue = String(item.value || '').trim();
          return (
            optionValue.toLowerCase() === lowerValue ||
            this.normalizeParamValue(optionValue) === normalized
          );
        });
        if (option) return option.value;
      }
    }

    return cleanValue;
  },

  trackField(form, wrapperOrInput) {
    if (!wrapperOrInput) return;

    const field = wrapperOrInput.matches('input, select, textarea')
      ? wrapperOrInput
      : wrapperOrInput.querySelector('input[name], select[name], textarea[name]');

    if (!field || field.type === 'file') return;

    const fieldKey = formFields.getFieldKey(wrapperOrInput);
    if (!fieldKey || formConfig.params.excludedFields.has(fieldKey)) return;

    form.syncedFieldKeys.add(fieldKey);
  },

  trackFieldsIn(form, root) {
    if (!root) return;
    formDom.getFields(root).forEach((field) => {
      this.trackField(form, field);
    });
  },

  clear(form) {
    if (!formConfig.params.enabled || !formConfig.params.updateUrl) return;

    const url = new URL(window.location.href);
    const prefix = form.key + formConfig.params.separator;
    let hasDeletions = false;

    Array.from(url.searchParams.keys()).forEach((key) => {
      if (key.startsWith(prefix)) {
        url.searchParams.delete(key);
        hasDeletions = true;
      }
    });

    form.syncedFieldKeys.clear();
    if (hasDeletions) this.write(url);
  },

  update(form) {
    if (!formConfig.params.enabled || !formConfig.params.updateUrl) return;
    if (!form.syncedFieldKeys.size) return;

    const url = new URL(window.location.href);
    const groups = this.getFieldGroups(form).filter((group) => {
      return form.syncedFieldKeys.has(group.fieldKey);
    });

    groups.forEach((group) => {
      this.getParamNames(form, group.fieldKey).forEach((paramName) => {
        url.searchParams.delete(paramName);
      });
    });

    const hasValues = groups.some((group) => this.getGroupValues(group.fields).length > 0);
    if (!hasValues) {
      this.write(url);
      return;
    }

    groups.forEach((group) => {
      this.getGroupValues(group.fields).forEach((value) => {
        url.searchParams.append(group.paramName, value);
      });
    });

    this.write(url);
  },

  write(url) {
    if (url.href === window.location.href) return;

    this.isWriting = true;
    window.history.replaceState(window.history.state, '', url);
    this.isWriting = false;
  },

  getFieldGroups(form) {
    const groups = new Map();

    formDom.getFields(form.root).forEach((wrapper) => {
      const inputs = Array.from(wrapper.querySelectorAll('input[name], select[name], textarea[name]'));
      inputs.forEach((input) => {
        const fieldKey = formFields.getFieldKey(input);
        if (!fieldKey || formConfig.params.excludedFields.has(fieldKey)) return;
        if (!formValues.shouldReadField(input)) return;

        const paramName = this.getParamName(form, fieldKey);

        if (!groups.has(paramName)) {
          groups.set(paramName, {
            fieldKey,
            paramName,
            fields: [],
          });
        }

        groups.get(paramName).fields.push(input);
      });
    });

    return Array.from(groups.values());
  },

  getParamName(form, fieldKey) {
    return form.key + formConfig.params.separator + fieldKey;
  },

  getParamNames(form, fieldKey) {
    const aliases = formConfig.params.fieldAliases?.[fieldKey] || [];
    return [fieldKey, ...aliases].map((key) => this.getParamName(form, key));
  },

  getGroupValues(fields) {
    const values = [];
    const scalarFields = fields.filter((field) => {
      return !formValues.isChoiceField(field) && !(field.tagName === 'SELECT' && field.multiple);
    });

    // Combine every non-empty scalar value (handles phone prefix + number).
    const scalarValues = [];
    scalarFields.forEach((field) => {
      if (!formValues.shouldReadField(field)) return;
      const value = String(field.value || '').trim();
      if (value) scalarValues.push(value);
    });
    if (scalarValues.length) values.push(scalarValues.join(''));

    fields.forEach((field) => {
      if (!formValues.shouldReadField(field)) return;

      if (formValues.isChoiceField(field)) {
        if (field.checked) {
          values.push(field.value);
        }
        return;
      }

      if (field.tagName === 'SELECT' && field.multiple) {
        Array.from(field.selectedOptions).forEach((option) => {
          const optValue = String(option.value || '').trim();
          if (optValue) values.push(optValue);
        });
      }
    });

    return values.filter(Boolean);
  },

  setGroupValues(fields, values) {
    const valueSet = new Set(values);
    const scalarFields = fields.filter((field) => {
      return !formValues.isChoiceField(field) && !(field.tagName === 'SELECT' && field.multiple);
    });
    const usePositionalValues = values.length > 1 && scalarFields.length > 1;
    let scalarIndex = 0;

    fields.forEach((field) => {
      if (formValues.isChoiceField(field)) {
        field.checked = valueSet.has(field.value) || (fields.length === 1 && valueSet.has('true'));
        formFields.setFilled(field);

        const choice = field.closest(SELECTORS.choice);
        if (choice) {
          formDom.setState(choice, 'selected', field.checked);
          choice.setAttribute('aria-checked', field.checked ? 'true' : 'false');
        }

        return;
      }

      if (field.tagName === 'SELECT' && field.multiple) {
        Array.from(field.options).forEach((option) => {
          option.selected = valueSet.has(option.value);
        });
        formFields.setFilled(field);
        return;
      }

      const newValue = values[usePositionalValues ? scalarIndex : 0];
      scalarIndex += 1;
      if (!newValue && newValue !== '0') return;

      field.value = newValue;
      formFields.setFilled(field);
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  },
};

// ============================================================================
