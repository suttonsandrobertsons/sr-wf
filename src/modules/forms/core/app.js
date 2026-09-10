import { SELECTORS, formConfig } from './shared.js';
import { formLogger, formDom } from './dom.js';
import { formFields } from './fields.js';
import { formFieldGroups } from './aggregate.js';
import { formChoices } from './choices.js';
import { formConditions } from './conditions.js';
import { formSteps, formParams } from './navigation.js';
import { formAttribution } from './attribution.js';
import { formSuccessPage } from './success-page.js';
import { formEvents } from './events.js';

// ============================================================================
// CENTRAL ORCHESTRATOR APP
// ============================================================================
export const formApp = {
  readyRoots: new WeakSet(),
  forms: new Set(),
  formKeys: new Set(),

  getFormByRoot(root) {
    if (!root) return null;
    for (const f of this.forms) {
      if (f.root === root) return f;
    }
    return null;
  },

  pruneDisconnected() {
    Array.from(this.forms).forEach((form) => {
      if (form.root?.isConnected) return;

      form.successObserver?.disconnect?.();
      form.failureObserver?.disconnect?.();
      this.forms.delete(form);
      this.formKeys.delete(form.key);
      // Drop the readyRoots latch so a reconnected same-node is re-created on boot.
      this.readyRoots.delete(form.root);
    });
  },

  boot(scope = document) {
    this.pruneDisconnected();
    formSuccessPage.scrollToTopIfNeeded();
    formSuccessPage.hydrateOutputs(scope);
    // form_submission push runs from the TY page, not pre-handoff: a native
    // lead-form POST races page-unload and the pre-handoff push can be lost.
    // Must run after hydrateOutputs, while the snapshot still exists; it clears
    // the snapshot once pushed.
    formSuccessPage.trackSuccess(scope);
    formAttribution.capture();

    const roots = [
      ...(scope.matches?.(SELECTORS.root) ? [scope] : []),
      ...Array.from(scope.querySelectorAll(SELECTORS.root)),
    ].filter((root) => root.isConnected);
    formLogger.log(null, 'Booting forms.', { count: roots.length, scoped: scope !== document });

    roots.forEach((root) => {
      if (this.readyRoots.has(root)) return;
      try {
        this.create(root);
        this.readyRoots.add(root);
      } catch (error) {
        formLogger.warn(null, 'Skipping form that failed to initialise.', error);
      }
    });

    formParams.watch();
  },

  create(root) {
    if (!(root instanceof HTMLFormElement)) {
      throw new Error('[data-form] must be added to the form element.');
    }

    this.prepareRoot(root);

    const formKey = this.getFormKey(root);

    if (this.formKeys.has(formKey)) {
      throw new Error('Each [data-form] form needs a unique data-form value or id. Duplicate key: ' + formKey);
    }

    this.formKeys.add(formKey);

    /** @typedef {{ root: HTMLFormElement, key: string, scope: Element, steps: Element[], stepIndex: number, syncedFieldKeys: Set<string>, isSubmitting?: boolean, hasTrackedSuccess?: boolean, hasPushedDataLayer?: boolean, successObserver?: MutationObserver, failureObserver?: MutationObserver, submissionMeta?: object }} FormInstance */
    const form = {
      root,
      key: formKey,
      scope: root.closest('.w-form') || root,
      steps: Array.from(root.querySelectorAll(SELECTORS.step)),
      stepIndex: 0,
      syncedFieldKeys: new Set(),
    };

    this.forms.add(form);

    formLogger.log(form, 'Creating form.', {
      id: form.key,
      steps: form.steps.length,
      fieldCount: formDom.getFields(form.root).length,
      uploadCount: form.root.querySelectorAll(SELECTORS.upload).length,
    });

    formFields.configure(form);
    formParams.hydrate(form);
    formFields.applyStartChecked(form);
    this.stripScopedParamsFromUrl(formKey);
    formEvents.bind(form);
    this.refresh(form);
    formDom.setState(root, 'loaded', true);
  },

  stripScopedParamsFromUrl(formKey) {
    if (!window.history.replaceState || !formConfig.params.stripAfterHydrate) return;

    const cleanUrl = new URL(window.location.href);
    const prefix = formKey + formConfig.params.separator;
    let changed = false;

    Array.from(cleanUrl.searchParams.keys()).forEach((key) => {
      if (key.startsWith(prefix)) {
        cleanUrl.searchParams.delete(key);
        changed = true;
      }
    });

    if (!changed) return;

    formParams.isWriting = true;
    window.history.replaceState(window.history.state, '', cleanUrl);
    formParams.isWriting = false;
  },

  getFormKey(root) {
    if (root.hasAttribute('data-form')) {
      const key = root.getAttribute('data-form');
      if (key && key.trim()) return key.trim();
    }

    return root.id || 'form';
  },

  prepareRoot(root) {
    if (!root.getAttribute('method') || root.getAttribute('method').toLowerCase() === 'get') {
      root.setAttribute('method', 'post');
    }
    root.noValidate = true;
    root.setAttribute('novalidate', 'novalidate');
  },

  refresh(form) {
    if (form && !form.scope) {
      const instance = this.getFormByRoot(form.root || form);
      if (instance) {
        form = instance;
      } else if (form.querySelectorAll) {
        form = { scope: form, root: form, steps: [] };
      }
    }
    formConditions.render(form);

    if (form.steps.length) {
      formSteps.render(form);
      // Second pass, after formSteps.render() changes step-hidden state: a
      // condition on a now-visible step can depend on a field whose value was
      // masked on the first pass by its own step being step-hidden.
      formConditions.render(form);
    }

    formFields.render(form);
    formChoices.render(form);
    formFieldGroups.render(form);
  },

  refreshAll() {
    this.forms.forEach((form) => {
      formParams.hydrate(form);
      this.refresh(form);
    });
  },
};

import { setFormApp } from './lazy-app.js';
setFormApp(formApp);

// ============================================================================
// DOCUMENT-LEVEL ATTRIBUTION FALLBACK
// ============================================================================
// Disabling does NOT remove a control from Webflow's payload. Its serialiser
// selects `:input:not([type="submit"]):not([type="file"]):not([type="button"])`
// with no `:not(:disabled)`, and jQuery's `.val()` reads disabled elements — so
// a disabled control is still submitted, with its value. Only RENAMING removes a
// key, and only the names in submit.chooseOneFieldNames are renamed.
//
// What this does buy: the browser's own constraint validation skips a disabled
// control, so a conditional `required` cannot block submit by trying to focus an
// invisible field. That is the reason to keep it.
//
// Verbatim serialiser: private repo local/webflow-runtime/serialiser.extract.js.
// To assert what a form submits, use the private repo's port at
// tools/twins/webflow/serialise.js — never new FormData(form), which omits
// disabled controls and so under-reports.
(function initSubmitControlGuard() {
  if (typeof document === 'undefined') return;

  document.addEventListener('submit', (event) => {
    const root = event.target;
    if (!(root instanceof HTMLFormElement) || !root.matches(SELECTORS.root)) return;

    const form = formApp.getFormByRoot(root) || { root, scope: root, steps: Array.from(root.querySelectorAll(SELECTORS.step)) };
    formApp.refresh(form);
    formFields.prepareControlsForSubmit(form);
  }, true);
})();

// Covers forms that lack data-form and were never initialised by formApp.boot().
(function initAttributionFallback() {
  if (typeof document === 'undefined') return;

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    // Excludes non-lead forms — search boxes, newsletter widgets, third-party
    // embeds — from receiving tracking hidden inputs.
    if (!form.closest('.w-form')) return;

    // Skip if the core module already wrote attribution.
    if (form.querySelector('[name="unique_id"]')) return;

    // Refresh attribution storage on each submit so UTM/landing data stays current.
    formAttribution.capture();
    formAttribution.setFields(form);
  }, true);
})();
