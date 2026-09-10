import { formDom, formLogger } from './dom.js';
import { formFields } from './fields.js';
import { formValues } from './values.js';
import { formParams } from './navigation.js';
import { escapeSelector } from './shared.js';
import { getFormApp } from './lazy-app.js';

/** Modes where this form proxies submit to another form on the page. */
export const SYNC_FORM_MODES = new Set(['mirror', 'sync']);

// Roots mid-submit via submitTargetForm. Clicking a target that is itself a
// managed sync form re-enters the sync guard synchronously; this latch stops
// the target recursively re-submitting.
const submittingRoots = new WeakSet();

export const SYNC_FORM_SELECTOR = [
  'form[data-form-sync-form]',
  'form[data-form-mirror-form]',
  'form[data-form-redirect-form]',
  'form[data-form-mode="sync"]',
  'form[data-form-mode="mirror"]',
  'form[data-form-mode="redirect"]',
].join(', ');

/**
 * Sync/mirror forms collect input in injected or component markup but hand off
 * to a native Webflow form elsewhere on the page. Configured entirely by attrs:
 *
 *   data-form-sync-form="footer-form"   (target data-form key or id; required)
 *   data-form-mode="sync" | "mirror"    (optional when sync-form is set)
 *   data-form-sync-fields="email:email" (optional; comma-separated from:to pairs)
 *
 * data-form-redirect-form, or data-form-mode="redirect" with an on-page
 * target (see hasOnPageTarget), also counts as sync; an off-page target goes
 * through formRedirect instead. isSync() is the single source of truth.
 */
export const formSync = {
  isSync(form) {
    const root = form?.root;
    if (!root) return false;

    if (root.hasAttribute('data-form-sync-form') || root.hasAttribute('data-form-mirror-form')) {
      return true;
    }

    const mode = (root.getAttribute('data-form-mode') || '').trim().toLowerCase();
    if (SYNC_FORM_MODES.has(mode)) return true;
    if (mode === 'redirect' && this.hasOnPageTarget(form)) return true;
    return false;
  },

  getTargetFormKey(form) {
    const root = form?.root;
    if (!root) return '';

    return (
      root.getAttribute('data-form-sync-form')
      || root.getAttribute('data-form-mirror-form')
      || root.getAttribute('data-form-redirect-form')
      || ''
    ).trim();
  },

  getTargetRoot(form) {
    const key = this.getTargetFormKey(form);
    if (!key) return null;

    // Attribute-value half is a quoted string, not an identifier — escape only
    // quote/backslash, since CSS.escape would over-escape hyphens/spaces. #id
    // half is an identifier token, so use CSS.escape there.
    const attrValue = String(key).replace(/(["\\])/g, '\\$1');
    return document.querySelector(`form[data-form="${attrValue}"], #${escapeSelector(key)}`);
  },

  hasOnPageTarget(form) {
    const targetRoot = this.getTargetRoot(form);
    if (!targetRoot) return false;
    return this.isSameDocumentRedirect(form);
  },

  isSameDocumentRedirect(form) {
    const root = form?.root;
    if (!root) return false;

    const raw = (
      root.getAttribute('data-form-redirect-url')
      || root.dataset.formSyncOriginalAction
      || root.getAttribute('action')
      || ''
    ).trim();

    if (!raw || raw.startsWith('#')) return true;

    try {
      const dest = new URL(raw, window.location.href);
      return dest.origin === window.location.origin && dest.pathname === window.location.pathname;
    } catch {
      return false;
    }
  },

  /** Block native GET navigation before boot (injected forms often ship with method="get"). */
  primeRoot(root) {
    if (!(root instanceof HTMLFormElement)) return;
    root.setAttribute('method', 'post');
    // Neutralise Webflow's method="get" — empty action + post avoids ?field=value navigation.
    if (!root.dataset.formSyncOriginalAction && root.hasAttribute('action')) {
      root.dataset.formSyncOriginalAction = root.getAttribute('action') || '';
    }
    root.setAttribute('action', '');
    root.noValidate = true;
    root.setAttribute('novalidate', 'novalidate');
  },

  mirrorFieldsToTarget(sourceForm) {
    const targetRoot = this.getTargetRoot(sourceForm);
    if (!targetRoot) return;

    const targetForm = getFormApp().getFormByRoot(targetRoot) || {
      root: targetRoot,
      key: targetRoot.getAttribute('data-form') || targetRoot.id || 'form',
      steps: [],
    };

    this.copyFields(sourceForm.root, targetForm, sourceForm);
  },

  getFieldMappings(form) {
    const raw = (form.root.getAttribute('data-form-sync-fields') || '').trim();
    if (!raw) return null;

    return raw.split(',').map((pair) => {
      const [from, to] = pair.split(':').map((part) => part.trim());
      if (!from) return null;
      return { from, to: to || from };
    }).filter(Boolean);
  },

  getDefaultMappings(sourceRoot) {
    const names = new Set();

    sourceRoot.querySelectorAll('input, select, textarea').forEach((field) => {
      if (!field.name || ['submit', 'button', 'reset', 'file'].includes(field.type)) return;
      names.add(field.name);
    });

    return [...names].map((name) => ({ from: name, to: name }));
  },

  copyFields(sourceRoot, targetForm, sourceForm) {
    const mappings = this.getFieldMappings(sourceForm) || this.getDefaultMappings(sourceRoot);

    mappings.forEach(({ from, to }) => {
      const values = formValues.get(sourceRoot, from).filter((value) => String(value || '').trim() !== '');
      if (!values.length) {
        this.clearTargetField(targetForm, to);
        return;
      }

      if (values.length === 1) {
        formParams.setFieldGroupValue(targetForm, to, values[0]);
        return;
      }

      const fields = Array.from(targetForm.root.querySelectorAll(formDom.getNameSelector(to)));
      if (!fields.length) return;
      const resolvedValues = values
        .map((value) => formParams.resolveFieldValue(fields, value))
        .filter((value, index, list) => value && list.indexOf(value) === index);
      if (!resolvedValues.length) return;
      formParams.setGroupValues(fields, resolvedValues);
    });
  },

  clearTargetField(targetForm, fieldName) {
    const fields = Array.from(targetForm.root.querySelectorAll(formDom.getNameSelector(fieldName)));
    if (!fields.length) return false;

    fields.forEach((field) => {
      if (formValues.isChoiceField(field)) {
        field.checked = false;
      } else if (field.tagName === 'SELECT' && field.multiple) {
        Array.from(field.options).forEach((option) => {
          option.selected = false;
        });
      } else {
        field.value = '';
      }

      formFields.setFilled(field);
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });

    return true;
  },

  submitToTarget(sourceForm) {
    const targetRoot = this.getTargetRoot(sourceForm);
    if (!targetRoot) {
      formLogger.warn(sourceForm, 'Sync target form missing — set data-form-sync-form to a form on this page.');
      return false;
    }

    let targetForm = getFormApp().getFormByRoot(targetRoot);
    if (!targetForm) {
      getFormApp().boot(document);
      targetForm = getFormApp().getFormByRoot(targetRoot);
    }

    const target = targetForm || {
      root: targetRoot,
      key: targetRoot.getAttribute('data-form') || targetRoot.id || 'form',
      steps: [],
    };

    this.copyFields(sourceForm.root, target, sourceForm);

    if (targetForm) {
      getFormApp().refresh(targetForm);
    }

    formLogger.log(sourceForm, 'Sync submit handed to target form.', { target: target.key });
    return this.submitTargetForm(targetRoot);
  },

  /** True while submitTargetForm is firing this root's submit control. */
  isSubmittingTarget(root) {
    return submittingRoots.has(root);
  },

  /** Fire the target's real submit control so Webflow's handler runs (same as a direct footer click). */
  submitTargetForm(targetRoot) {
    if (submittingRoots.has(targetRoot)) {
      formLogger.warn({ root: targetRoot }, 'Re-entrant sync submit blocked.');
      return false;
    }

    submittingRoots.add(targetRoot);
    try {
      const submitBtn = targetRoot.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) {
        submitBtn.click();
        return true;
      }

      targetRoot.requestSubmit();
      return true;
    } finally {
      submittingRoots.delete(targetRoot);
    }
  },
};
