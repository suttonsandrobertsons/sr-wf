// Field behaviour: types, filters, validation and required-ness.
//
// Related: uploads in ./uploads.js, value reading in ./values.js, the 'filled'
// stamp in ./field-state.js, and the group aggregate in ./aggregate.js.

import { SELECTORS, formConfig, fieldTypes, fieldFilters, fieldValidators, fieldRules, cleanPhoneInput, parseNumber, escapeSelector, isEnabledAttribute } from './shared.js';
import { formLogger, formDom } from './dom.js';
import { formChoices } from './choices.js';
import { getFormApp } from './lazy-app.js';
import { formValues } from './values.js';
import { formUploads } from './uploads.js';
import { setFilled as setFilledState, getWrap as getWrapEl } from './field-state.js';

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
    this.prepareChooseOneControls(form);

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

    // Zoho's email field rejects a leading/trailing dot or whitespace
    // ("jo@x.com." fails the Zap). Strip them on blur and again at submit.
    // Internal dots (sub.domains, first.last) are kept.
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
    this.prepareChooseOneControls(form);

    formChoices.prepareFieldsForSubmit(form);
  },

  // CHOOSE-ONE. A field authored as several same-named controls in the
  // Designer, of which exactly one should reach Zapier — the one whose
  // condition currently matches. Only `bullion_name` uses this: it is a real
  // <select> the customer operates, so it cannot move to
  // submit-values/business-rules.js.
  //
  // Inactive controls are renamed with the disabled-name prefix rather than
  // disabled: this runs on every render, and a disabled control can't be
  // used, so the customer could not switch which control is active.
  prepareChooseOneControls(form) {
    const root = form?.root;
    if (!root) return;

    const chooseOneNames = this.getChooseOneFieldNames(root);
    const unsubmittedNamePrefix = formConfig.submit?.unsubmittedNamePrefix || '_disabled_';
    const groups = new Map();

    root.querySelectorAll('[name], [data-form-submit-original-name], [data-form-submit-single]').forEach((control) => {
      const originalName = control.getAttribute('data-form-submit-original-name') || control.getAttribute('name') || '';
      const currentName = control.getAttribute('name') || originalName;
      const isConfiguredName = chooseOneNames.has(originalName) || chooseOneNames.has(currentName);
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
        control.setAttribute('name', isActive ? originalName : `${unsubmittedNamePrefix}${originalName}`);
      });
    });
  },

  getChooseOneFieldNames(root) {
    const names = [
      ...(formConfig.submit?.chooseOneFieldNames || []),
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

  // Delegates to ./field-state.js, which uploads.js also uses.
  setFilled(field) {
    setFilledState(field);
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
    return getWrapEl(field);
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
// submit-values/business-rules.js instead when the value needs a rule a join cannot express:
// arithmetic, a conditional pick, or a mapping to differently-named outputs.
//
// An empty group disables its hidden input, but Webflow submits disabled
// controls (see core/app.js), so it still arrives as an empty value
// (`brands=""`), the same as an empty derived field.
//
