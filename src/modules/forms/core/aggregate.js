// Combining several controls into the one value that gets submitted.
//
// Two mechanisms build an aggregate and they are easy to confuse:
//
//   [data-form-field-group]  several DIFFERENT controls -> one field
//                            ("brands": three text inputs joined by commas)
//   checkbox group           several checkboxes of ONE field -> one field
//                            ("contact_preferences": Email,Phone)
//
// Both share the functions here; they differ only in the marker attribute
// each stamps on its hidden input.
//
// Why a hidden input at all: Webflow submits `fields[name] = value` per
// control, so N controls sharing a name collapse to the last one in document
// order. The aggregate wins only because it is appended last.

import { SELECTORS, escapeSelector } from './shared.js';
import { formValues } from './values.js';

function formatGroupValue(values) {
  return values.length === 1 ? values[0] : values.join(',');
}

// The checkbox path also disables its native checkboxes. That does not make
// the aggregate win (see choices.js), but it does stop native validation
// focusing an invisible control.

/**
 * Find or create the hidden input that carries a group's combined value.
 *
 * Append order matters. Webflow assigns fields[name] = value, so controls
 * sharing a name collapse to the last in document order. When the aggregate
 * shares its name with the controls it summarises, being last is the only
 * reason the combined string wins. Insert it earlier and a checkbox group
 * submits the boolean true instead of "Email,Phone".
 */
export function ensureAggregateHidden(root, fieldName, markerAttribute) {
  const escaped = escapeSelector(fieldName);
  let hidden = root.querySelector(`input[type='hidden'][data-form-name='${escaped}']`)
    || root.querySelector(`input[type='hidden'][name='${escaped}']`);

  if (!hidden) {
    hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = fieldName;
    root.appendChild(hidden);
  }

  hidden.setAttribute('data-form-name', fieldName);
  if (markerAttribute) hidden.setAttribute(markerAttribute, 'true');
  return hidden;
}

/**
 * Write a group's combined value, or blank-and-disable when there is nothing.
 *
 * Disabling an empty aggregate does not remove it from the payload: Webflow
 * submits disabled controls. It marks the field unanswered for our own
 * validation. The key still arrives, as an empty string.
 *
 * @returns {boolean} true when the group had a value.
 */
export function writeAggregateValue(hidden, values) {
  if (!values.length) {
    hidden.value = '';
    hidden.disabled = true;
    return false;
  }

  hidden.value = formatGroupValue(values);
  hidden.disabled = false;
  return true;
}

// Neither mechanism removes a key. Only choose-one (submit.chooseOneFieldNames)
// does, by renaming the others to `_disabled_<name>`; Webflow ignores
// `disabled` (see core/app.js).

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

      writeAggregateValue(hidden, values);
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
    return ensureAggregateHidden(root, fieldName, 'data-form-field-list');
  },
};

// ============================================================================
