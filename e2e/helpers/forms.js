// Shared helpers for driving the live multi-step forms in smoke tests.
//
// These specs run against the PUBLISHED site, so the one hard rule is that they
// must never create a real lead: installSubmitCapture() intercepts the Webflow
// form endpoint, records the payload and answers 200 itself, so the form behaves
// as though it submitted while nothing reaches Webflow, Zapier or Zoho.

const FORM_ENDPOINT = "**/api/v1/form/**";

// Where a captured payload is written for the twins to resolve.
//
// These specs produce the one thing the private repo's Zapier twin cannot make
// for itself: a payload from the REAL published form, with real CMS options and
// the real serialiser. The twin then answers "what would Zoho store?" without
// anyone submitting a lead. See tools/twins/chain/__tests__/live-capture.test.js
// in the private repo, which is skipped when this directory is empty.
const CAPTURE_DIR = process.env.SR_CAPTURE_DIR
  || new URL("../.captures/", import.meta.url).pathname;

/**
 * Intercept the form POST. Returns a getter for the captured field map.
 *
 * Webflow posts `fields[NAME]=value`, so the raw body is unwrapped into a plain
 * object of NAME -> [values]. Values are kept as arrays because the whole point
 * of several of these tests is proving only ONE control submits under a name.
 */
export async function installSubmitCapture(page) {
  const captured = [];
  await page.route(FORM_ENDPOINT, async (route) => {
    captured.push(route.request().postData() || "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"ok":true}',
    });
  });

  return {
    count: () => captured.length,
    fields: () => {
      if (!captured.length) return null;
      const params = new URLSearchParams(captured[0]);
      const out = {};
      for (const [key, value] of params.entries()) {
        const match = key.match(/^fields\[(.+)\]$/);
        if (match) (out[match[1]] ||= []).push(value);
      }
      return out;
    },
    /**
     * Write the captured payload for the twins, flattened to Zapier's shape.
     *
     * Zapier receives one value per key, so duplicates collapse the way
     * Webflow's serialiser leaves them: last in DOM order wins.
     */
    save: async (name) => {
      if (!captured.length) throw new Error(`nothing captured for ${name}`);
      const params = new URLSearchParams(captured[0]);
      const flat = {};
      for (const [key, value] of params.entries()) {
        const match = key.match(/^fields\[(.+)\]$/);
        if (match) flat[match[1]] = value;
      }
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(CAPTURE_DIR, { recursive: true });
      await writeFile(
        `${CAPTURE_DIR}/${name}.json`,
        `${JSON.stringify({ capturedAt: new Date().toISOString(), form: name, payload: flat }, null, 2)}\n`,
      );
      return flat;
    },

    // Single value for a field, or null. Fails loudly on duplicates so a
    // regression that submits two values under one name can't read as a pass.
    one: (map, name) => {
      const values = map[name];
      if (!values) return null;
      if (values.length > 1) throw new Error(`${name} submitted ${values.length} values: ${values.join(" | ")}`);
      return values[0];
    },
  };
}

// Injected into the page: fills every visible required field, walks the steps,
// and stops on the final step without submitting. `answers` values are pinned —
// the generic filler never overwrites them.
const DRIVER = `(key, answers, opts) => {
  window.__srDrive = async () => {
    const form = document.querySelector('[data-form="' + key + '"]');
    if (!form) return { error: 'form not found: ' + key };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const vis = (el) => el.offsetParent !== null;
    const setVal = (el, v) => {
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
        : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      ['input', 'change'].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
    };
    const applyAnswers = () => {
      for (const [name, value] of Object.entries(answers)) {
        const els = [...form.querySelectorAll('[name="' + name + '"]')];
        const choice = els.find((e) => (e.type === 'radio' || e.type === 'checkbox') && e.value === value);
        if (choice) {
          if (!choice.checked) {
            choice.checked = true;
            ['input', 'change', 'click'].forEach((t) => choice.dispatchEvent(new Event(t, { bubbles: true })));
          }
        } else if (els[0] && els[0].value !== value) setVal(els[0], value);
      }
    };
    const fill = () => {
      applyAnswers();
      form.querySelectorAll('input,select,textarea').forEach((el) => {
        if (!vis(el) || el.disabled || el.type === 'file' || el.type === 'hidden') return;
        if (Object.prototype.hasOwnProperty.call(answers, el.name)) return;
        if (!(el.hasAttribute('required') || el.closest('[data-form-field-required]'))) return;
        if (el.type === 'radio' || el.type === 'checkbox') {
          const group = [...form.querySelectorAll('[name="' + el.name + '"]')].filter(vis);
          if (group.some((g) => g.checked)) return;
          group[0].checked = true;
          ['input', 'change', 'click'].forEach((t) => group[0].dispatchEvent(new Event(t, { bubbles: true })));
        } else if (el.tagName === 'SELECT') {
          if (el.value) return;
          const opt = [...el.options].find((o) => o.value);
          if (opt) setVal(el, opt.value);
        } else if (!el.value) {
          const type = (el.type || '').toLowerCase();
          const name = (el.name || '').toLowerCase();
          let v = 'test';
          if (type === 'email' || name.includes('email')) v = answers.email || 'e2e@example.com';
          else if (type === 'tel' || name.includes('phone')) v = '7700900123';
          else if (type === 'date') v = '2026-09-15';
          else if (type === 'time') v = '11:00';
          else if (name.includes('postcode')) v = 'SW1A 1AA';
          else if (name.includes('town') || name.includes('city') || name.includes('county')) v = 'London';
          else if (name.includes('address') || name.includes('house')) v = 'E2E TEST - NOT A REAL LEAD';
          else if (type === 'number') v = '1';
          setVal(el, v);
        }
      });
    };
    applyAnswers(); await sleep(500); applyAnswers(); await sleep(250);
    const steps = [];
    for (let i = 0; i < 9; i++) {
      fill(); await sleep(400);
      if (opts && opts.manualAddress) {
        const toggle = [...form.querySelectorAll('button,a,div')].find((b) =>
          vis(b) && /enter (it )?manually|manual/i.test((b.innerText || '').trim()) && (b.innerText || '').length < 40);
        if (toggle) { toggle.click(); await sleep(600); fill(); await sleep(300); }
      }
      steps.push(form.querySelector('[data-form-step][data-form-state~="active"]')?.getAttribute('data-form-step') || null);
      const next = [...form.querySelectorAll('[data-form-action="next"]')].find(vis);
      if (!next) break;
      next.click(); await sleep(900);
    }
    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    const blocking = [...form.querySelectorAll('input,select,textarea')]
      .filter((el) => vis(el) && (el.hasAttribute('required') || el.closest('[data-form-field-required]'))
        && !el.value && el.type !== 'radio' && el.type !== 'checkbox')
      .map((el) => el.name);
    return { steps, blocking, canSubmit: !!(submit && vis(submit)) };
  };
}`;

/** Walk a form to its final step. Does NOT submit. */
export async function advanceToEnd(page, formKey, answers = {}, opts = {}) {
  await page.evaluate(`(${DRIVER})(${JSON.stringify(formKey)}, ${JSON.stringify(answers)}, ${JSON.stringify(opts)})`);
  return page.evaluate(() => window.__srDrive());
}

/** Walk a form to the end and submit it (interception must be installed). */
export async function fillAndSubmit(page, formKey, answers = {}, opts = {}) {
  const result = await advanceToEnd(page, formKey, answers, opts);
  if (!result.canSubmit) return result;
  await page.evaluate((key) => {
    const form = document.querySelector(`[data-form="${key}"]`);
    form.querySelector('button[type="submit"], input[type="submit"]').click();
  }, formKey);
  await page.waitForTimeout(2500);
  return result;
}

export async function pickRadio(page, formKey, name, value) {
  return page.evaluate(({ formKey, name, value }) => {
    const form = document.querySelector(`[data-form="${formKey}"]`);
    const radio = [...form.querySelectorAll(`[name="${name}"]`)].find((r) => r.value === value);
    if (!radio) return false;
    radio.checked = true;
    ["input", "change", "click"].forEach((t) => radio.dispatchEvent(new Event(t, { bubbles: true })));
    return true;
  }, { formKey, name, value });
}

export async function fieldState(page, formKey, name) {
  return page.evaluate(({ formKey, name }) => {
    const form = document.querySelector(`[data-form="${formKey}"]`);
    if (!form) return { missing: "form" };
    const els = [...form.querySelectorAll(`[name="${name}"]`)];
    if (!els.length) return { present: false };
    return {
      present: true,
      count: els.length,
      values: els.map((e) => e.value),
      checked: els.filter((e) => e.checked).map((e) => e.value),
      visible: els.some((e) => e.offsetParent !== null),
      conditionHidden: els.every((e) =>
        /condition-hidden/.test(e.closest("[data-form-state]")?.getAttribute("data-form-state") || "")),
      required: els.some((e) => e.hasAttribute("required") || !!e.closest("[data-form-field-required]")),
    };
  }, { formKey, name });
}

export const LEAD_FORMS = [
  { key: "get-a-quote", path: "/get-a-quote" },
  { key: "appointment", path: "/find-us/make-an-appointment" },
  { key: "appointment", path: "/about/contact" },
  { key: "courier", path: "/courier-service" },
  { key: "courier", path: "/sell-gold/sell-gold-by-post" },
  { key: "gold", path: "/dev/forms/gold-calculator" },
];
