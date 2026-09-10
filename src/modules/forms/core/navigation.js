// Moving through a form: multi-step navigation, and the URL state that
// mirrors it.
//
// formSteps and formParams are one file because they call each other — a step
// change writes the URL, and a URL change sets the step. Splitting them would
// buy two names and a circular import.
//
// Split out of conditions.js on 9 Sep 2026.

import { SELECTORS, formConfig } from './shared.js';
import { formLogger, formDom } from './dom.js';
import { formFields } from './fields.js';
import { formValues } from './values.js';
import { getFormApp } from './lazy-app.js';

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
