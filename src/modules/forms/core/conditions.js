// Show-if / hide-if evaluation.
//
// Related: ./navigation.js (steps and URL params), ./attribution.js,
// ./redirect.js and ./success-page.js.
//
// `hide-if` is supported for symmetry with `show-if` but has no known use in
// the Designer.

import { SELECTORS } from './shared.js';
import { formDom } from './dom.js';
import { formValues } from './values.js';
import { formSteps } from './navigation.js';

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
        // A plain split on "," would cut a value containing a comma (e.g.
        // "Hello, world"). Split only where the comma starts a new rule (a negation,
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
