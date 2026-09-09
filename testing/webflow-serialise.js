// Webflow's own form serialiser, ported faithfully.
//
// Read from `function I(t, a)` in webflow.achunk.dac51c455b7e76af.js, the forms
// chunk of this site's Webflow runtime, on 9 September 2026. A copy of that
// runtime is kept (gitignored) at
// suttons-robertsons-private/local/webflow-runtime/, with the function lifted
// verbatim into serialiser.extract.js beside it.
//
// WHY THIS EXISTS. Tests reached for `new FormData(form)` to ask "what does
// this form submit". FormData omits disabled controls; Webflow's serialiser
// does not. Measured on the live /get-a-quote form, mid-flow: FormData saw 30
// keys, Webflow's rules saw 49. So every assertion of the form "this field is
// not submitted" that used FormData was testing the wrong serialiser, and the
// 19 extra keys include stale answers from branches the customer abandoned.
//
// Use this to ask what Webflow sends. Use FormData only to ask what FormData
// sends, which is almost never the question.
//
// The URLs are content-hashed, so a new Webflow runtime changes the filenames.
// Re-diff serialiser.extract.js against the new chunk before trusting this.

const SKIPPED_TYPES = new Set(["submit", "file", "button"]);

/**
 * Serialise a form the way Webflow does.
 *
 * @param {HTMLFormElement} root
 * @param {{ encodeKeys?: boolean }} [options] Webflow encodeURIComponent-s each
 *   key. Off by default so assertions read naturally; turn it on to compare
 *   against a captured payload.
 * @returns {Record<string, string|boolean|null>} keys in insertion order
 */
export function webflowSerialise(root, options = {}) {
  const fields = {};
  if (!root?.querySelectorAll) return fields;

  // jQuery ':input' is input/select/textarea/button. There is deliberately no
  // :not(:disabled) here — that absence is the whole point of this module.
  const controls = root.querySelectorAll("input, select, textarea, button");

  let index = 0;
  controls.forEach((control) => {
    // Webflow excludes by ATTRIBUTE, not by effective type: a bare <button>
    // has no type attribute, so it is NOT excluded and does get serialised —
    // even though the browser treats it as a submit button. Skipping it here
    // would make this port disagree with the runtime.
    const type = String(control.getAttribute("type") || "").toLowerCase();
    if (SKIPPED_TYPES.has(type)) return;

    index += 1;
    const rawKey =
      control.getAttribute("data-name") ||
      control.getAttribute("name") ||
      `Field ${index}`;
    const key = options.encodeKeys ? encodeURIComponent(rawKey) : rawKey;

    let value = control.value;

    if (type === "checkbox") {
      value = control.checked;
    } else if (type === "radio") {
      // Radios are the exception to last-wins. The serialiser sets the key
      // once, from `input[name=...]:checked`, then returns early for every
      // later element of that name. So repeated radio elements cannot clobber
      // the answer, whereas a repeated text input can — `fields[key] = value`
      // overwrites, and the last one in DOM order lands.
      if (fields[key] === null || typeof fields[key] === "string") return;
      const checked = root.querySelector(
        `input[name="${control.getAttribute("name")}"]:checked`,
      );
      value = checked ? checked.value : null;
    }

    if (typeof value === "string") value = value.trim();
    fields[key] = value;
  });

  return fields;
}

/**
 * The keys Webflow would submit, in order. Handy for asserting absence.
 */
export function webflowKeys(root, options) {
  return Object.keys(webflowSerialise(root, options));
}

/**
 * What FormData misses. Every entry here is a value that reaches Webflow —
 * and therefore Zapier and Zoho — while our own FormData-based reads cannot
 * see it. A non-empty result is not automatically a bug, but each key is a
 * value being submitted that nothing in our tests is asserting.
 */
export function serialiserGap(root) {
  const webflow = webflowSerialise(root);
  const formData = {};
  new FormData(root).forEach((value, key) => {
    formData[key] = value;
  });

  return Object.keys(webflow)
    .filter((key) => !(key in formData))
    .map((key) => [key, webflow[key]]);
}
