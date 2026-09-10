import { formConfig, fieldValidators } from "./config.js";
import { formLogger, formApp, formValues } from "./core.js";
import { debounce } from "../../utils/debounce.js";

const cfg = formConfig.address;
const UK_FILTER = cfg.ukOnly ? ["GB"] : null;
const isDemo = () => cfg.demo && !cfg.googlePlacesApiKey;

// One shared document pointerdown handler, not one per init, so repeated
// inits don't stack listeners.
const outsideClickTargets = new Set();
let outsideClickRegistered = false;

function registerOutsideClick(input, suggestions) {
  outsideClickTargets.add({ input, suggestions });
  if (outsideClickRegistered) return;
  outsideClickRegistered = true;
  document.addEventListener("pointerdown", (event) => {
    outsideClickTargets.forEach((entry) => {
      const { input: i, suggestions: s } = entry;
      if (!i.isConnected) {
        outsideClickTargets.delete(entry);
        return;
      }
      if (event.target === i || s.contains(event.target)) return;
      clearSuggestions(s);
    });
  });
}

function q(selector, root = document) {
  return root.querySelector(selector);
}

function fillField(form, name, value) {
  const el = q(`[name="${name}"]`, form);
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setDefaultCountry(form) {
  if (!cfg.ukOnly) return;
  fillField(form, "country", "United Kingdom");
}

// Canonicalises a UK postcode to upper-case with a space before the inward
// code, e.g. "nw21dl" -> "NW2 1DL". Only touches postcode-shaped input
// (5-7 chars); anything else returns trimmed, unchanged.
function normalisePostcode(value) {
  const compact = String(value || "").toUpperCase().replace(/\s+/g, "");
  if (compact.length < 5 || compact.length > 7) return String(value || "").trim();
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function setAddressMode(form, mode) {
  formValues.setHidden(form, "address_mode", mode);
  formApp.refresh(form);
}

function makeAddressLine2Optional(form) {
  const field = q('[name="address_line_2"]', form);
  if (!field) return;
  const wrap = field.closest("[data-form-field]");
  [wrap, field].filter(Boolean).forEach((el) => {
    if (el.hasAttribute("data-form-field-required")) {
      el.setAttribute("data-form-field-required", "false");
    }
  });
  field.required = false;
}

function fillAddressFields(form, a) {
  const values = {
    town_city: a.town_city,
    county: a.county,
    postcode: a.postcode,
    country: a.country,
    address_line_2: a.sublocality,
  };
  if (q('[name="house_number"]', form)) {
    // Dedicated field present: number in its own field, street on Line 1.
    values.house_number = a.houseNumber;
    values.address_line_1 = a.street;
  } else {
    // No house-number field on this form: fold the number back onto Line 1.
    values.address_line_1 = [a.houseNumber, a.street].filter(Boolean).join(" ");
  }
  Object.entries(values).forEach(([name, value]) => fillField(form, name, value));
  updateCombinedLine1(form);
}

// Zoho reads one "First Address Line". With a dedicated house_number field,
// keep a hidden combined value ("42"+"Bath Road" -> "42 Bath Road") that
// field maps to. No-op without house_number.
function updateCombinedLine1(form) {
  if (!q('[name="house_number"]', form)) return;
  const house = (q('[name="house_number"]', form)?.value || "").trim();
  const street = (q('[name="address_line_1"]', form)?.value || "").trim();
  formValues.setHidden(form, "address_line_1_combined", [house, street].filter(Boolean).join(" "));
}

function cleanSuggestionText(value) {
  const text = String(value ?? "").trim();
  return /^(none|null|undefined)$/i.test(text) ? "" : text;
}

const DEMO_SUGGESTIONS = [
  { mainText: "12 High Street", secondaryText: "London, SW1A 1AA" },
  { mainText: "12 Park Lane", secondaryText: "London, W1K 7QF" },
  { mainText: "12 Oxford Road", secondaryText: "Manchester, M1 5BD" },
  { mainText: "12 Queen Street", secondaryText: "Bristol, BS1 4HQ" },
  { mainText: "12 King's Road", secondaryText: "Brighton, BN1 1NB" },
  { mainText: "45 Church Street", secondaryText: "Birmingham, B3 2DL" },
  { mainText: "45 George Square", secondaryText: "Edinburgh, EH2 2HH" },
  { mainText: "78 Victoria Street", secondaryText: "Leeds, LS1 6BD" },
  { mainText: "78 Castle Street", secondaryText: "Liverpool, L2 0NE" },
  { mainText: "3 Market Square", secondaryText: "Cambridge, CB2 3QZ" },
];

const DEMO_DETAILS = {
  "12 High Street": {
    address_line_1: "12 High Street",
    address_line_2: "",
    town_city: "London",
    county: "Greater London",
    postcode: "SW1A 1AA",
  },
  "12 Park Lane": {
    address_line_1: "12 Park Lane",
    address_line_2: "",
    town_city: "London",
    county: "Greater London",
    postcode: "W1K 7QF",
  },
  "12 Oxford Road": {
    address_line_1: "12 Oxford Road",
    address_line_2: "",
    town_city: "Manchester",
    county: "Greater Manchester",
    postcode: "M1 5BD",
  },
  "12 Queen Street": {
    address_line_1: "12 Queen Street",
    address_line_2: "",
    town_city: "Bristol",
    county: "Bristol",
    postcode: "BS1 4HQ",
  },
  "12 King's Road": {
    address_line_1: "12 King's Road",
    address_line_2: "",
    town_city: "Brighton",
    county: "East Sussex",
    postcode: "BN1 1NB",
  },
  "45 Church Street": {
    address_line_1: "45 Church Street",
    address_line_2: "",
    town_city: "Birmingham",
    county: "West Midlands",
    postcode: "B3 2DL",
  },
  "45 George Square": {
    address_line_1: "45 George Square",
    address_line_2: "",
    town_city: "Edinburgh",
    county: "Edinburgh",
    postcode: "EH2 2HH",
  },
  "78 Victoria Street": {
    address_line_1: "78 Victoria Street",
    address_line_2: "",
    town_city: "Leeds",
    county: "West Yorkshire",
    postcode: "LS1 6BD",
  },
  "78 Castle Street": {
    address_line_1: "78 Castle Street",
    address_line_2: "",
    town_city: "Liverpool",
    county: "Merseyside",
    postcode: "L2 0NE",
  },
  "3 Market Square": {
    address_line_1: "3 Market Square",
    address_line_2: "",
    town_city: "Cambridge",
    county: "Cambridgeshire",
    postcode: "CB2 3QZ",
  },
};

function demoAutocomplete(query) {
  const tokens = String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = tokens.length
    ? DEMO_SUGGESTIONS.filter((s) => {
        const haystack = [s.mainText, s.secondaryText].filter(Boolean).join(", ").toLowerCase();
        return tokens.every((t) => haystack.includes(t));
      })
    : DEMO_SUGGESTIONS;
  return matches.slice(0, 5).map((s) => ({
    placeId: s.mainText,
    mainText: s.mainText,
    secondaryText: s.secondaryText,
    fullText: [s.mainText, s.secondaryText].filter(Boolean).join(", "),
  }));
}

function demoPlaceDetails(mainText) {
  const addr = DEMO_DETAILS[mainText];
  if (!addr) {
    return {
      addressComponents: [
        { longText: mainText, types: ["street_address"] },
        { longText: "London", types: ["locality"] },
        { longText: "Greater London", types: ["administrative_area_level_1"] },
        { longText: "SW1A 1AA", types: ["postal_code"] },
      ],
    };
  }
  const comps = [{ longText: addr.address_line_1, types: ["street_address"] }];
  if (addr.town_city) comps.push({ longText: addr.town_city, types: ["locality"] });
  if (addr.county) comps.push({ longText: addr.county, types: ["administrative_area_level_1"] });
  if (addr.postcode) comps.push({ longText: addr.postcode, types: ["postal_code"] });
  return { addressComponents: comps };
}

async function googleAutocomplete(query) {
  const res = await fetch(`${cfg.placesApiBase}/places:autocomplete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": cfg.googlePlacesApiKey },
    body: JSON.stringify({ input: query, ...(UK_FILTER ? { includedRegionCodes: UK_FILTER } : {}) }),
  });
  if (!res.ok) throw new Error(`places autocomplete ${res.status}`);
  const data = await res.json();
  return (data.suggestions || []).map((s) => {
    const p = s.placePrediction || {};
    const mainText = cleanSuggestionText(p.structuredFormat?.mainText?.text || p.text?.text || "");
    const secondaryText = cleanSuggestionText(p.structuredFormat?.secondaryText?.text || "");
    return {
      placeId: p.placeId,
      mainText,
      secondaryText,
      fullText: cleanSuggestionText(p.text?.text) || [mainText, secondaryText].filter(Boolean).join(", "),
    };
  });
}

async function googlePlaceDetails(placeId) {
  const res = await fetch(`${cfg.placesApiBase}/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": cfg.googlePlacesApiKey,
      "X-Goog-FieldMask": "addressComponents,formattedAddress",
    },
  });
  if (!res.ok) throw new Error(`places details ${res.status}`);
  return res.json();
}

function parseAddress(components) {
  const m = {};
  (components || []).forEach((c) => {
    c.types.forEach((t) => {
      (m[t] || (m[t] = [])).push(c.longText || c.shortText || "");
    });
  });

  // Premises identifier (flat/building/house number) stays separate from the
  // street. A postcode-only search returns no number, so the required
  // house_number field is left to prompt the customer.
  const houseNumber = [m.subpremise?.[0], m.premise?.[0], m.street_number?.[0]]
    .filter(Boolean).join(", ");
  const street = m.route?.[0] || m.street_address?.[0] || "";
  const city = m.locality?.[0] || m.postal_town?.[0] || m.post_town?.[0] || "";
  const sublocality = m.sublocality?.[0] || m.sublocality_level_1?.[0] || "";
  const county = m.administrative_area_level_2?.[0] || m.administrative_area_level_1?.[0] || city;
  const postcode = m.postal_code?.[0] || "";
  const country = m.country?.[0] || (cfg.ukOnly ? "United Kingdom" : "");

  return {
    houseNumber,
    street,
    sublocality,
    town_city: city,
    county,
    postcode,
    country,
  };
}

function buildSuggestions(form, input) {
  let selectWrap = q("[data-form-address-suggestions]", form)?.closest("[data-form-select]");
  if (!selectWrap) {
    selectWrap = document.createElement("div");
    selectWrap.setAttribute("data-form-select", "");
    const wrap = document.createElement("div");
    wrap.setAttribute("data-form-address-suggestions", "");
    wrap.hidden = true;
    const list = document.createElement("ul");
    list.setAttribute("role", "listbox");
    wrap.appendChild(list);
    selectWrap.appendChild(wrap);
    input.after(selectWrap);
  }
  clearSuggestions(selectWrap);

  if (selectWrap._addrListenersAttached) return selectWrap;
  selectWrap._addrListenersAttached = true;

  selectWrap.addEventListener("click", (event) => {
    const opt = event.target.closest("[data-form-select-option]");
    if (opt) {
      event.preventDefault();
      pickSuggestion(form, input, opt.dataset.formSelectOption,
        opt.dataset.formAddressText || opt.querySelector("[data-suggestion-main]")?.textContent || "", selectWrap);
    }
  });

  selectWrap.addEventListener("mousedown", (event) => {
    if (event.target.closest("[data-form-select-option]")) event.preventDefault();
  });

  const handleKeydown = (event) => {
    const wrap = selectWrap.querySelector("[data-form-address-suggestions]");
    const opts = [...wrap.querySelectorAll("[data-form-select-option]")];
    if (!opts.length) return;
    const idx = opts.indexOf(document.activeElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        opts[Math.min(idx + 1, opts.length - 1)].focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        opts[Math.max(idx - 1, 0)].focus();
        break;
      case "Enter":
        event.preventDefault();
        if (idx >= 0) pickSuggestion(form, input, opts[idx].dataset.formSelectOption,
          opts[idx].dataset.formAddressText || opts[idx].querySelector("[data-suggestion-main]")?.textContent || "", selectWrap);
        break;
      case "Escape":
        clearSuggestions(selectWrap);
        input.focus();
        break;
    }
  };

  selectWrap.addEventListener("keydown", handleKeydown);
  input.addEventListener("keydown", handleKeydown);

  return selectWrap;
}

function toggleOpen(el, isOpen) {
  const states = new Set((el.getAttribute("data-form-state") || "").split(/\s+/).filter(Boolean));
  if (isOpen) states.add("open"); else states.delete("open");
  const value = Array.from(states).join(" ");
  if (value) el.setAttribute("data-form-state", value); else el.removeAttribute("data-form-state");
}

function setSuggestionsOpen(container, isOpen) {
  const wrap = container.querySelector("[data-form-address-suggestions]");
  if (wrap) wrap.hidden = !isOpen;
  toggleOpen(container, isOpen);
}

function clearSuggestions(container, options = {}) {
  const clearDelayMs = Number(options.clearDelayMs) || 0;
  if (container._addrClearTimer) clearTimeout(container._addrClearTimer);
  const list = container.querySelector("[data-form-address-suggestions] ul");
  setSuggestionsOpen(container, false);
  if (!list) {
    container._addrClearTimer = null;
    return;
  }
  if (clearDelayMs > 0) {
    container._addrClearTimer = setTimeout(() => {
      list.innerHTML = "";
      container._addrClearTimer = null;
    }, clearDelayMs);
    return;
  }
  list.innerHTML = "";
  container._addrClearTimer = null;
}

function renderSuggestions(container, items, form) {
  const list = container.querySelector("[data-form-address-suggestions] ul");
  if (!list) return;
  if (container._addrClearTimer) { clearTimeout(container._addrClearTimer); container._addrClearTimer = null; }
  list.innerHTML = "";

  const template = (form || document).querySelector("[data-form-address-template]");
  if (!template || !items.length) { setSuggestionsOpen(container, false); return; }

  items.forEach((s) => {
    const frag = template.content.cloneNode(true);
    const li = frag.firstElementChild;
    const mainText = cleanSuggestionText(s.mainText);
    const secondaryText = cleanSuggestionText(s.secondaryText);
    li.dataset.formSelectOption = s.placeId;
    li.dataset.formAddressText = cleanSuggestionText(s.fullText) || [mainText, secondaryText].filter(Boolean).join(", ");
    const main = li.querySelector("[data-suggestion-main]");
    if (main) main.textContent = secondaryText ? `${mainText}.` : mainText;
    const sub = li.querySelector("[data-suggestion-sub]");
    if (secondaryText) {
      if (sub) sub.textContent = secondaryText;
    } else {
      sub?.remove();
    }
    list.appendChild(li);
  });

  setSuggestionsOpen(container, true);
}

async function pickSuggestion(form, input, placeId, text, container) {
  clearSuggestions(container, { clearDelayMs: 250 });
  container._addrSuppressInput = true;
  fillField(form, "address_search", text);
  container._addrSuppressInput = false;
  const pickGen = (container._addrPickGen = (container._addrPickGen || 0) + 1);
  try {
    const data = isDemo()
      ? demoPlaceDetails(placeId)
      : await googlePlaceDetails(placeId);
    if (pickGen !== container._addrPickGen) return;
    fillAddressFields(form, parseAddress(data.addressComponents));
    setAddressMode(form, "found");
  } catch (error) {
    if (pickGen !== container._addrPickGen) return;
    formLogger.warn?.(form, "place details failed", error);
  }
}

function searchAddresses(query) {
  if (isDemo()) return demoAutocomplete(query);
  return googleAutocomplete(query);
}

function init(form) {
  if (form.hasAttribute("data-form-address-initialised")) return;
  if (!cfg.demo && !cfg.googlePlacesApiKey) return;

  const input = q('[name="address_search"]', form);
  if (!input) return;
  form.setAttribute("data-form-address-initialised", "true");
  makeAddressLine2Optional(form);
  setDefaultCountry(form);

  if (isDemo()) {
    formLogger.log?.(form, "address demo mode active — no API key needed");
  }

  const suggestions = buildSuggestions(form, input);
  const manualTrigger = q("[data-form-address-manual]", form);
  const autoTrigger = q("[data-form-address-auto]", form);
  const inputWrapper = input.closest("[data-form-field]");
  let lastVal = "";
  let gen = 0;

  const search = debounce(async (query) => {
    if (!input.isConnected) return;
    if (query.length < 3) { clearSuggestions(suggestions); return; }
    if (document.activeElement !== input && !suggestions.contains(document.activeElement)) return;
    const tag = ++gen;
    try {
      const items = await searchAddresses(query);
      if (tag !== gen) return;
      renderSuggestions(suggestions, items, form);
    } catch (e) {
      if (tag !== gen) return;
      formLogger.warn?.(form, "address search failed", e);
      clearSuggestions(suggestions);
    }
  }, 300);

  let blurTimer = null;

  input.addEventListener("input", () => {
    const v = input.value.trim();
    if (suggestions._addrSuppressInput) {
      lastVal = v;
      setSuggestionsOpen(suggestions, false);
      return;
    }
    if (v === lastVal) return;
    lastVal = v;
    search(v);
  });

  input.addEventListener("blur", () => {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (!suggestions.contains(document.activeElement)) clearSuggestions(suggestions);
    }, 150);
  });

  input.addEventListener("focus", () => {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
    if (suggestions._addrClearTimer) return;
    if (suggestions.querySelector("[data-form-select-option]")) setSuggestionsOpen(suggestions, true);
  });

  if (manualTrigger) {
    manualTrigger.addEventListener("click", (e) => {
      e.preventDefault();
      clearSuggestions(suggestions);
      if (inputWrapper) inputWrapper.hidden = true;
      input.hidden = true;
      // People often search by postcode; prefilling Line 1 with it would let
      // a bare postcode satisfy required-Line-1 and land in the CRM's street
      // field. A postcode goes to the postcode field (normalised); anything
      // else prefills Line 1. Empty search prefills nothing.
      const typed = input.value.trim();
      const hasPostcodeField = !!q('[name="postcode"]', form);
      if (typed && hasPostcodeField && fieldValidators.postcode(typed)) {
        fillField(form, "postcode", normalisePostcode(typed));
      } else if (typed) {
        fillField(form, "address_line_1", typed);
      }
      updateCombinedLine1(form);
      setDefaultCountry(form);
      setAddressMode(form, "manual");
    });
  }

  if (autoTrigger) {
    autoTrigger.addEventListener("click", (e) => {
      e.preventDefault();
      if (inputWrapper) inputWrapper.hidden = false;
      input.hidden = false;
      setAddressMode(form, "search");
      input.focus();
    });
  }

  const postcodeInput = q('[name="postcode"]', form);
  if (postcodeInput) {
    postcodeInput.addEventListener("blur", () => {
      const v = postcodeInput.value.trim();
      if (v && fieldValidators.postcode(v)) fillField(form, "postcode", normalisePostcode(v));
    });
  }

  const houseInput = q('[name="house_number"]', form);
  if (houseInput) {
    const recombine = () => updateCombinedLine1(form);
    houseInput.addEventListener("input", recombine);
    q('[name="address_line_1"]', form)?.addEventListener("input", recombine);
    updateCombinedLine1(form);
  }

  registerOutsideClick(input, suggestions);
}

export function initAddressForms(scope = document) {
  if (!cfg.demo && !cfg.googlePlacesApiKey) return;
  const forms = [
    ...(scope.matches?.("[data-form-address]") ? [scope] : []),
    ...scope.querySelectorAll("[data-form-address]"),
  ];
  forms.forEach(init);
}
