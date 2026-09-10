// The 'filled' state stamp, and the wrapper a control belongs to.
//
// Extracted from formFields on 10 Sep 2026 so uploads.js can stamp a control
// without importing fields.js.
//
// formFields.setFilled and formFields.getWrap still exist and delegate here,
// so external callers did not change.

import { SELECTORS } from './shared.js';
import { formDom } from './dom.js';
import { formValues } from './values.js';

/** The [data-form-field] or [data-form-upload] wrapper around a control. */
export function getWrap(field) {
  return field.closest(SELECTORS.field) || field.closest(SELECTORS.upload);
}

/** Stamp 'filled' on a control and its wrapper, from whether it has a value. */
export function setFilled(field) {
  const root = field.closest(SELECTORS.root) || document;
  const isFilled = formValues.hasFieldValue(root, field);
  const wrap = getWrap(field);

  formDom.setState(field, 'filled', isFilled);
  if (wrap) {
    formDom.setState(wrap, 'filled', isFilled);
  }
}
