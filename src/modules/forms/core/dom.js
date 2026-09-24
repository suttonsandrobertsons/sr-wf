import { SELECTORS, isDomElement, closestWithinRoot, escapeSelector, isEnabledAttribute } from './shared.js';

export const formLogger = {
  log(formOrRoot, message, data) {},
  warn(formOrRoot, message, data) {},
  error(formOrRoot, message, data) {},
};

// ============================================================================
// CORE DOM UTILITIES
// ============================================================================
export const formDom = {
  hiddenDisplays: new WeakMap(),

  getControls(root) {
    return Array.from(root.querySelectorAll(SELECTORS.controls));
  },

  getFields(root) {
    return Array.from(root.querySelectorAll(SELECTORS.field));
  },

  getEventField(root, target) {
    if (!isDomElement(target)) return null;
    const wrapper = target.closest(SELECTORS.field);
    if (!wrapper || !root.contains(wrapper)) return null;
    return wrapper;
  },

  closestWithin(root, target, selector) {
    return closestWithinRoot(root, target, selector);
  },

  isElement(value) {
    return isDomElement(value);
  },

  isConditionHidden(element) {
    return Boolean(element.closest("[data-form-state~='condition-hidden']"));
  },

  skipsInlineConditionHide(element) {
    const form = element?.closest?.("[data-form]");
    return form?.getAttribute("data-form-condition-mode") === "inline-hide-off";
  },

  isStepHidden(element) {
    return Boolean(element.closest("[data-form-state~='step-hidden']"));
  },

  // A field hidden by CSS alone (a designer `display:none` on it or an
  // ancestor) carries none of our condition/step state, but must still count
  // as hidden — otherwise submit blocks on an error the customer can't see.
  //
  // Computed `display`/`visibility` is authoritative: it works under jsdom too.
  // `offsetParent === null` is only a fast-path for real layout, and never for
  // `position:fixed` (offsetParent is always null there, even when visible).
  isVisuallyHidden(element) {
    if (!isDomElement(element)) return false;
    if (typeof window === 'undefined' || !window.getComputedStyle) return false;

    const ownStyle = window.getComputedStyle(element);
    if (ownStyle.display === 'none' || ownStyle.visibility === 'hidden') return true;

    // jsdom reports offsetParent as null for everything, so trust it only when
    // hasLayoutEngine confirms real layout. Excludes position:fixed.
    if (element.offsetParent === null && ownStyle.position !== 'fixed' && this.hasLayoutEngine()) {
      return true;
    }

    // Catches display:none set on an ancestor rather than the element itself.
    let ancestor = element.parentElement;
    while (ancestor) {
      const style = window.getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
      ancestor = ancestor.parentElement;
    }

    return false;
  },

  // True in a real browser; false under jsdom, where offsetParent is always
  // null and cannot signal visibility.
  hasLayoutEngine() {
    if (typeof document === 'undefined' || !document.body) return false;
    return document.body.offsetParent !== null || document.body.offsetHeight > 0;
  },

  setRendered(element, shouldShow) {
    if (!element) {
      throw new Error('Cannot render form visibility without an element.');
    }

    if (!shouldShow) {
      if (!this.hiddenDisplays.has(element)) {
        this.hiddenDisplays.set(element, {
          value: element.style.getPropertyValue('display'),
          priority: element.style.getPropertyPriority('display'),
        });
      }
      element.style.setProperty('display', 'none', 'important');
      return;
    }

    const originalDisplay = this.hiddenDisplays.get(element);
    if (!originalDisplay) return;

    if (originalDisplay.value) {
      element.style.setProperty('display', originalDisplay.value, originalDisplay.priority);
    } else {
      element.style.removeProperty('display');
    }
    this.hiddenDisplays.delete(element);
  },

  setState(element, state, shouldAdd) {
    if (!element) {
      throw new Error('Cannot set form state without an element.');
    }

    const applyState = (el) => {
      const states = new Set((el.getAttribute('data-form-state') || '').split(' ').filter(Boolean));

      if (shouldAdd) {
        states.add(state);
      } else {
        states.delete(state);
      }

      const value = Array.from(states).join(' ');

      if (value) {
        el.setAttribute('data-form-state', value);
      } else {
        el.removeAttribute('data-form-state');
      }
    };

    // Stamps the owning element AND every descendant. Required: CSS styling
    // selectors target `data-form-state` on descendant nodes, not only the
    // owner, so `applyState(element)` alone is not enough.
    applyState(element);
    element.querySelectorAll('*').forEach(applyState);
  },

  setText(root, selector, value) {
    root.querySelectorAll(selector).forEach((element) => {
      element.textContent = value;
    });
  },

  getNameSelector(name, tagName) {
    const prefix = tagName ? tagName : '';
    return prefix + "[name='" + this.escape(name) + "']";
  },

  escape(value) {
    return escapeSelector(value);
  },

  getDone(form) {
    if (!form.scope) return null;
    return form.scope.querySelector('.w-form-done');
  },

  getFail(form) {
    if (!form.scope) return null;
    return form.scope.querySelector('.w-form-fail');
  },

  showSuccess(form) {
    const done = this.getDone(form);
    if (done) done.style.display = 'block';
    if (form.root) form.root.style.display = 'none';
  },

  hideSuccess(form) {
    const done = this.getDone(form);
    if (done) done.style.display = 'none';
    if (form.root) form.root.style.display = '';
  },

  clearChoiceGroupError(input) {
    if (input.type !== 'checkbox' && input.type !== 'radio') return;
    const group = input.closest(SELECTORS.choiceGroup);
    if (!group) return;
    formDom.setState(group, 'invalid', false);
    const error = group.querySelector(SELECTORS.error);
    if (error) error.textContent = '';
  },
};
