// What Webflow submits. Use this in tests, not new FormData(form).
//
// FormData omits disabled controls. Webflow's serialiser does not: its selector
// has no :not(:disabled), and jQuery .val() reads disabled elements. Measured
// on /get-a-quote mid-flow, FormData saw 30 keys and Webflow saw 49. The extra
// 19 were stale answers from abandoned branches. They all reach Zapier; only
// the ones a Zap maps reach Zoho.
//
// This is a MIRROR. The authority is the private repo port at
// tools/twins/webflow/serialise.js, which is diffed against the runtime source.
// It is not imported here because this repo is public and must test standalone.
// If the two disagree, the port wins.

const SKIPPED_TYPES = new Set(["submit", "file", "button"]);

/**
 * Serialise a form the way Webflow does.
 *
 * Checkboxes return booleans. An unanswered radio group returns null. Every
 * control yields a key, including empty ones. A key is absent only when no
 * control carries that name.
 */
export function submittedFields(root) {
  const fields = {};
  if (!root?.querySelectorAll) return fields;

  // jQuery ':input' is input/select/textarea/button, with no :not(:disabled).
  let index = 0;
  root.querySelectorAll("input, select, textarea, button").forEach((control) => {
    // Exclusion is by attribute, not effective type. A bare <button> has no
    // type attribute, so Webflow serialises it.
    const type = String(control.getAttribute("type") || "").toLowerCase();
    if (SKIPPED_TYPES.has(type)) return;

    index += 1;
    const key = control.getAttribute("data-name") || control.getAttribute("name") || `Field ${index}`;
    let value = control.value;

    if (type === "checkbox") {
      value = control.checked;
    } else if (type === "radio") {
      // Radios are the exception to last-wins. The key is set once from the
      // checked option, so repeated radios cannot overwrite the answer.
      if (fields[key] === null || typeof fields[key] === "string") return;
      const checked = root.querySelector(`input[name="${control.getAttribute("name")}"]:checked`);
      value = checked ? checked.value : null;
    }

    if (typeof value === "string") value = value.trim();
    // Plain assignment. Duplicate names collapse to the last control in DOM
    // order: a deterministic wrong value, not a multi-value field.
    fields[key] = value;
  });

  return fields;
}

/** The same, as [key, value] pairs, for tests that assert on entries. */
export function submittedEntries(root) {
  return Object.entries(submittedFields(root));
}

/** The keys Webflow would submit, in order. Handy for asserting absence. */
export function submittedKeys(root) {
  return Object.keys(submittedFields(root));
}
