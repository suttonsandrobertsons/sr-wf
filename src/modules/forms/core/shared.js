import { formConfig, fieldTypes, fieldFilters, fieldValidators, fieldRules, cleanPhoneInput, buildPhoneValue } from "../config.js";
import { isElement as isDomElement, escapeSelector, closestWithin as closestWithinRoot } from "../../../utils/dom.js";
import { parseNumber } from "../numbers.js";

const SELECTORS = formConfig.selectors;

function isEnabledAttribute(element, name) {
  if (!element?.hasAttribute?.(name)) return false;
  const value = String(element.getAttribute(name) || '').trim().toLowerCase();
  return value === 'true';
}

export {
  formConfig,
  fieldTypes,
  fieldFilters,
  fieldValidators,
  fieldRules,
  cleanPhoneInput,
  buildPhoneValue,
  parseNumber,
  isDomElement,
  escapeSelector,
  closestWithinRoot,
  SELECTORS,
  isEnabledAttribute,
};
