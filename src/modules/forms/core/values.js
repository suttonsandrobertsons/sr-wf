// Reading a value off a control, and deciding whether to read it at all.
//
// shouldOmitControl is the rule that decides what reaches Zapier. Note it is
// NOT the same rule as formFields.shouldSkipValidation, which also excludes
// step-hidden and visually-hidden controls. A control on a step the customer
// has left is skipped by validation but still read, and still submitted.

import { formDom } from './dom.js';
import { parseNumber } from '../numbers.js';

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
