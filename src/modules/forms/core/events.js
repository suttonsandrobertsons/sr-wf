import { SELECTORS } from './shared.js';
import { formLogger, formDom } from './dom.js';
import { formFields } from './fields.js';
import { formUploads } from './uploads.js';
import { formChoices } from './choices.js';
import { formSteps, formParams } from './navigation.js';
import { formRedirect } from './redirect.js';
import { formAttribution } from './attribution.js';
import { formSync } from './sync.js';
import { getFormApp } from './lazy-app.js';
import { formSubmitValues } from '../submit-values/index.js';

let hasSyncSubmitGuard = false;

// Keeps bind() idempotent across re-init — e.g. a pruned-then-reconnected node
// re-created by formApp.boot.
const boundRoots = new WeakSet();

function resolveSyncForm(root) {
  const formApp = getFormApp();
  if (!formApp.getFormByRoot(root)) {
    formApp.boot(document);
  }

  return formApp.getFormByRoot(root) || {
    root,
    key: root.getAttribute('data-form') || root.id || 'form',
    steps: [],
  };
}

function runSyncSubmit(root) {
  // A sync target re-enters here synchronously while its own submit control is
  // being clicked; skip to avoid recursive re-submit.
  if (formSync.isSubmittingTarget(root)) return;

  formSync.primeRoot(root);

  const form = resolveSyncForm(root);
  const event = new Event('submit', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: root });
  Object.defineProperty(event, 'currentTarget', { value: root });
  formEvents.handleSubmit(form, event);
}

function getComposedClosest(event, selector) {
  for (const node of event.composedPath?.() || []) {
    if (!(node instanceof Element)) continue;
    if (node.matches?.(selector)) return node;
    const closest = node.closest?.(selector);
    if (closest) return closest;
  }

  return event.target?.closest?.(selector) || null;
}

function getSubmitterForm(submitter) {
  if (!submitter) return null;
  if (submitter.form) return submitter.form;
  return submitter.closest?.('form') || null;
}

// EVENT LISTENER BINDING
// ============================================================================
export const formEvents = {
  emitChange(form, detail = {}) {
    try {
      form.root.dispatchEvent(new CustomEvent('suttons:form-change', {
        detail: { form, ...detail },
        bubbles: true,
      }));
    } catch {}
  },

  live(form) {
    return getFormApp().getFormByRoot(form.root) || form;
  },

  bind(form) {
    // Observers live on the form object, not the DOM node, so a reconnected
    // root with a fresh form object needs them re-established even when its
    // DOM listeners persist from a previous bind. Do this before the guard below.
    this.watchSuccess(form);
    this.watchFailure(form);

    // DOM listeners persist on a detached node; re-binding on a reconnected
    // root would double-add them.
    if (boundRoots.has(form.root)) return;
    boundRoots.add(form.root);

    form.root.addEventListener('input', (event) => {
      this.handleInput(this.live(form), event);
    });

    form.root.addEventListener('change', (event) => {
      this.handleChange(this.live(form), event).catch((error) => {
        formLogger.error(form, 'Change handler failed.', error);
      });
    });

    form.root.addEventListener('click', (event) => {
      this.handleClick(this.live(form), event);
    });

    if (formSync.isSync(form)) {
      const mirrorToTarget = () => formSync.mirrorFieldsToTarget(this.live(form));
      form.root.addEventListener('input', mirrorToTarget);
      form.root.addEventListener('change', mirrorToTarget);
    }

    form.root.addEventListener(
      'submit',
      (event) => {
        this.handleSubmit(this.live(form), event);
      },
      true,
    );

    // Reset actions live inside .w-form-done, a sibling of the form.
    const wForm = form.scope;
    if (wForm) {
      wForm.addEventListener('click', (event) => {
        const resetBtn = event.target.closest('[data-form-action="reset"], [data-form-action="clear"]');
        if (resetBtn) {
          event.preventDefault();
          this.handleAction(this.live(form), resetBtn);
        }
      });
    }

    form.root.addEventListener('click', (event) => {
      const liveForm = this.live(form);
      const trigger = event.target.closest(SELECTORS.uploadTrigger);
      if (trigger) {
        event.preventDefault();
        const upload = trigger.closest(SELECTORS.upload);
        if (!upload) {
          formLogger.error(liveForm, 'Upload trigger clicked but no [data-form-upload] ancestor found.');
          return;
        }
        formUploads.open(liveForm, upload);
        return;
      }

      const remove = event.target.closest(SELECTORS.uploadRemove);
      if (remove) {
        event.preventDefault();
        const upload = remove.closest(SELECTORS.upload);
        if (upload) {
          formParams.trackFieldsIn(liveForm, upload);
          formUploads.reset(upload);
          getFormApp().refresh(liveForm);
          formParams.update(liveForm);
        }
        return;
      }
    });
  },

  handleInput(form, event) {
    const inputField = event.target;
    if (inputField && (inputField.type === 'number' || inputField.inputMode === 'decimal' || inputField.inputMode === 'numeric') && inputField.value && inputField.value.startsWith('-')) {
      inputField.value = inputField.value.replace(/^-/, '');
    }

    const wrapper = formDom.getEventField(form.root, event.target);
    if (!wrapper) return;

    const field = formFields.getInputFromWrapper(wrapper);
    if (!field) return;

    formFields.filterInput(field);
    formFields.clearError(field);
    formParams.trackField(form, wrapper);
    getFormApp().refresh(form);
    this.emitChange(form, { reason: 'input', field, sourceEvent: event });
    formParams.update(form);
  },

  async handleFieldChange(form, field, { reason, sourceEvent, wrapper } = {}) {
    if (!field) return;

    formFields.filterInput(field);
    formFields.normalizeField(field);
    formFields.clearError(field);
    formParams.trackField(form, wrapper || field);
    formDom.clearChoiceGroupError(field);
    formChoices.clearNamedChoiceError(form.root, field);

    getFormApp().refresh(form);
    this.emitChange(form, { reason, field, sourceEvent });
    formParams.update(form);
  },

  async handleChange(form, event) {
    const wrapper = formDom.getEventField(form.root, event.target);

    if (wrapper) {
      const field = formFields.getInputFromWrapper(wrapper);
      if (!field) return;

      await this.handleFieldChange(form, field, { reason: 'change', sourceEvent: event, wrapper });
      return;
    }

    const choice = formDom.closestWithin(form.root, event.target, SELECTORS.choice);
    const input = choice ? formChoices.getInput(choice) : null;
    if (input && event.target === input) {
      await this.handleFieldChange(form, input, { reason: 'choice', sourceEvent: event });
    }
  },

  handleClick(form, event) {
    const action = formDom.closestWithin(form.root, event.target, SELECTORS.action);

    if (action) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.handleAction(form, action);
      return;
    }

    const choice = formDom.closestWithin(form.root, event.target, SELECTORS.choice);

    if (choice) {
      const input = formChoices.getInput(choice);
      if (formChoices.shouldLetNestedControlHandleClick(event, choice, input)) return;

      const toggled = formChoices.handleClick(event, choice);
      if (!toggled || !input) return;

      formFields.validateStandaloneChoice(form, choice);

      const wrapper = formDom.getEventField(form.root, input);
      if (!wrapper) {
        this.handleFieldChange(form, input, { reason: 'choice', sourceEvent: event }).catch((error) => {
          formLogger.error(form, 'Choice change handler failed.', error);
        });
      }
      return;
    }

  },

  runRedirectSubmit(form) {
    if (form.isSubmitting) {
      formLogger.warn(form, 'Duplicate redirect blocked.');
      return;
    }

    getFormApp().refresh(form);

    if (form.steps.length && !formSteps.validateAvailableAndReveal(form)) {
      formLogger.warn(form, 'Redirect blocked by invalid available step.', { step: formSteps.getCurrentNumber(form) });
      return;
    }

    if (!form.steps.length && !formFields.validateScope(form, form.root)) {
      formLogger.warn(form, 'Redirect blocked by validation.');
      return;
    }

    if (!formRedirect.isRedirect(form)) {
      formLogger.warn(form, 'Redirect submit called on non-redirect form.');
      return;
    }

    formFields.normalizeBeforeSubmit(form);
    getFormApp().refresh(form);
    formSubmitValues.apply(form.root);
    const redirectValues = formRedirect.getRedirectValues(form);
    formAttribution.capture();
    const attributionMeta = formAttribution.setFields(form);
    formAttribution.storeSuccessSnapshot(form, attributionMeta);
    form.isSubmitting = true;
    formRedirect.submit(form, redirectValues, attributionMeta);
    formLogger.log(form, 'Redirect form submitted.');
  },

  handleSubmit(form, event) {
    formLogger.log(form, 'handleSubmit triggered.');

    if (form.isSubmitting) {
      event.preventDefault();
      event.stopImmediatePropagation();
      formLogger.warn(form, 'Duplicate submit blocked.');
      return;
    }

    getFormApp().refresh(form);

    if (form.steps.length && !formSteps.validateAvailableAndReveal(form)) {
      formLogger.warn(form, 'Submit blocked by invalid available step.', { step: formSteps.getCurrentNumber(form) });
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (!form.steps.length && !formFields.validateScope(form, form.root)) {
      formLogger.warn(form, 'Submit blocked by validation.');
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    formLogger.log(form, 'Submit passed validation, processing.');

    // The success-path work below can throw. Uncaught, isSubmitting would stay
    // true (blocking later submits as duplicates) and the button disabled.
    // Catch resets submit state so the customer can retry.
    try {
      formFields.normalizeBeforeSubmit(form);
      getFormApp().refresh(form);

      if (formSync.isSync(form)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        formSync.submitToTarget(form);
        formLogger.log(form, 'Sync form submitted via target.');
        return;
      }

      formFields.prepareControlsForSubmit(form);
      formSubmitValues.apply(form.root);
      formAttribution.capture();
      const attributionMeta = formAttribution.setFields(form);

      const isRedirectSubmit = formRedirect.isRedirect(form);
      if (!isRedirectSubmit) {
        formParams.clear(form);
        form.isSubmitting = true;
        // Pushes GTM once before handoff: Webflow can navigate to the success
        // URL before the .w-form-done watcher observes a visible success state.
        formAttribution.pushDataLayer(form);
      }

      // For quote-sheet.js, which sets quote_pdf_url, and the optional dev
      // tooling. Fired after the final refresh so the dev table mirrors the
      // Webflow/Zapier payload.
      try {
        form.root.dispatchEvent(new CustomEvent('suttons:form-submit', {
          detail: { form, originalEvent: event },
          bubbles: true
        }));
      } catch {}
      // After the event, so the snapshot carries quote_pdf_url.
      formAttribution.storeSuccessSnapshot(form, attributionMeta);

      if (isRedirectSubmit) {
        const redirectValues = formRedirect.getRedirectValues(form);
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        // Generates attribution + unique_id before navigation so the redirect
        // URL carries Reference/UTM/organic; also writes hidden inputs on the
        // source form for completeness.
        form.isSubmitting = true;
        formRedirect.submit(form, redirectValues, attributionMeta);
        formLogger.log(form, 'Redirect form submitted.');
        return;
      }

      // Native handoff to Webflow. Fallback timer: if neither the success
      // (.w-form-done) nor failure (.w-form-fail) observer fires in time (hung
      // request, CORS, adblock), clear submit state so the customer is not
      // locked out. Observers clear this timer if they fire first (clearSubmitTimeout).
      this.armSubmitTimeout(form);
      formLogger.log(form, 'Form handed to Webflow.');
    } catch (error) {
      // Reset submit state so the customer can retry. If the native event was
      // not prevented, Webflow's own submit still runs.
      formLogger.error(form, 'Submit success-path threw; resetting submit state.', error);
      this.resetSubmitState(form);
    }
  },

  // Restores a form from an in-flight submit back to an idle, retryable state.
  resetSubmitState(form) {
    this.clearSubmitTimeout(form);
    form.isSubmitting = false;
    const root = form?.root;
    if (!root) return;
    // Re-enable any submit controls disabled during prepareControlsForSubmit /
    // Webflow's own handoff so the button is clickable again.
    root.querySelectorAll('button[type="submit"], input[type="submit"], [data-form-action="submit"]').forEach((control) => {
      if (control.disabled) control.disabled = false;
    });
  },

  armSubmitTimeout(form, timeoutMs = 30000) {
    this.clearSubmitTimeout(form);
    if (typeof setTimeout !== 'function') return;
    form.submitTimeoutId = setTimeout(() => {
      form.submitTimeoutId = null;
      if (!form.isSubmitting || form.hasTrackedSuccess) return;
      formLogger.warn(form, 'Submit timed out with no Webflow success/fail; resetting.');
      this.resetSubmitState(form);
    }, timeoutMs);
  },

  clearSubmitTimeout(form) {
    if (form && form.submitTimeoutId) {
      clearTimeout(form.submitTimeoutId);
      form.submitTimeoutId = null;
    }
  },

  handleAction(form, action) {
    const actionName = action.getAttribute('data-form-action') || '';
    formLogger.log(form, 'Action clicked.', { action: actionName });

    if (actionName === 'next') {
      formSteps.goBy(form, 1);
      return;
    }

    if (actionName === 'back' || actionName === 'prev' || actionName === 'previous') {
      formSteps.goBy(form, -1);
      return;
    }

    if (actionName === 'submit' || actionName === 'redirect') {
      if (formSync.isSync(form)) {
        form.root.requestSubmit();
        return;
      }

      if (formRedirect.isRedirect(form)) {
        this.runRedirectSubmit(form);
      } else if (actionName === 'submit') {
        form.root.requestSubmit();
      } else {
        formLogger.warn(form, 'Redirect action ignored on non-redirect form.');
      }
      return;
    }

    if (actionName === 'reset' || actionName === 'clear') {
      if (actionName === 'clear') {
        formFields.clear(form);
      } else {
        formFields.reset(form);
      }
      formParams.clear(form);
      getFormApp().refresh(form);
      this.emitChange(form, { reason: actionName, action });

      formDom.hideSuccess(form);
      this.clearSubmitTimeout(form);
      form.isSubmitting = false;
      form.hasTrackedSuccess = false;

      // onWebflowSuccess disconnects both observers as terminal; a reset revives
      // the form for reuse, so re-establish them for the next submit.
      this.watchSuccess(form);
      this.watchFailure(form);

      formSteps.scrollToForm(form);
      formLogger.log(form, 'Form reset.');
      return;
    }

    formLogger.warn(form, 'Unknown action ignored.', { action: actionName });
  },

  watchSuccess(form) {
    const done = formDom.getDone(form);
    if (!done) return;

    const handleSuccess = () => {
      if (form.hasTrackedSuccess) return;
      if (!form.isSubmitting) return;
      if (!this.isVisible(done)) return;

      this.onWebflowSuccess(form);
    };

    form.successObserver?.disconnect?.();
    const observer = new MutationObserver(handleSuccess);
    observer.observe(done, { attributes: true, attributeFilter: ['style', 'class', 'data-form-state'] });
    form.successObserver = observer;
  },

  onWebflowSuccess(form) {
    if (form.hasTrackedSuccess) return;

    form.hasTrackedSuccess = true;
    form.isSubmitting = false;
    this.clearSubmitTimeout(form);
    // Success is terminal: disconnect both observers.
    form.successObserver?.disconnect?.();
    form.failureObserver?.disconnect?.();
    formAttribution.pushDataLayer(form);
    this.hideWebflowStates(form);
    formAttribution.redirectToThankYou(form);
  },

  watchFailure(form) {
    const fail = formDom.getFail(form);
    if (!fail) return;

    const handleFailure = () => {
      if (!this.isVisible(fail)) return;

      form.isSubmitting = false;
      this.clearSubmitTimeout(form);
      formLogger.warn(form, 'Webflow failure detected.');
    };

    form.failureObserver?.disconnect?.();
    const observer = new MutationObserver(handleFailure);
    observer.observe(fail, { attributes: true, attributeFilter: ['style', 'class', 'data-form-state'] });
    form.failureObserver = observer;
  },

  isVisible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  },

  hideWebflowStates(form) {
    const done = formDom.getDone(form);
    const fail = formDom.getFail(form);
    if (done) done.style.display = 'none';
    if (fail) fail.style.display = 'none';
    form.root.style.display = 'none';
  },
};

// Guards injected sync forms (fs-inject), which may submit before formApp.boot()
// binds listeners — otherwise method="get" on the Webflow preset navigates with
// ?email=… in the URL.
export function initSyncSubmitGuard() {
  if (typeof document === 'undefined') return;
  if (hasSyncSubmitGuard) return;
  hasSyncSubmitGuard = true;

  const isSyncRoot = (root) => root instanceof HTMLFormElement && formSync.isSync({ root, steps: [] });

  // Earliest interception — beats native GET navigation from method="get" presets.
  document.addEventListener('click', (event) => {
    const submitter = getComposedClosest(event, 'button[type="submit"], input[type="submit"]');
    if (!submitter) return;

    const root = getSubmitterForm(submitter);
    if (!isSyncRoot(root)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    runSyncSubmit(root);
  }, true);

  document.addEventListener('submit', (event) => {
    const root = event.target;
    if (!isSyncRoot(root)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    runSyncSubmit(root);
  }, true);
}
