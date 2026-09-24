import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { submittedFields } from "./helpers/webflow-submit.js"

describe("address module (demo mode)", () => {
  let formEl;
  let searchInput;
  let manualBtn;
  let autoBtn;

  function addInput(name) {
    const input = document.createElement("input");
    input.name = name;
    formEl.appendChild(input);
    return input;
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useRealTimers();

    const { formConfig } = await import("../config.js");
    formConfig.address.demo = true;
    formConfig.address.googlePlacesApiKey = "";

    formEl = document.createElement("form");
    formEl.setAttribute("data-form-address", "");
    formEl.setAttribute("data-form", "test");

    searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.name = "address_search";
    formEl.appendChild(searchInput);

    addInput("address_line_1");
    const addr2 = addInput("address_line_2");
    addr2.setAttribute("data-form-field-required", "true");
    addInput("town_city");
    addInput("county");
    addInput("postcode");
    addInput("country");

    manualBtn = document.createElement("button");
    manualBtn.setAttribute("data-form-address-manual", "");
    formEl.appendChild(manualBtn);

    autoBtn = document.createElement("button");
    autoBtn.setAttribute("data-form-address-auto", "");
    formEl.appendChild(autoBtn);

    const template = document.createElement("template");
    template.setAttribute("data-form-address-template", "");
    template.innerHTML = `
      <li data-form-select-option tabindex="-1">
        <span data-suggestion-main></span>
        <span data-suggestion-sub></span>
      </li>
    `;
    formEl.appendChild(template);
    document.body.appendChild(formEl);
  });

  afterEach(() => {
    formEl?.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("initialises a form with data-form-address", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);
    expect(formEl.hasAttribute("data-form-address-initialised")).toBe(true);
  });

  it("does not initialise if disabled (no demo, no key)", async () => {
    const { formConfig } = await import("../config.js");
    formConfig.address.demo = false;
    formConfig.address.googlePlacesApiKey = "";

    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);
    expect(formEl.hasAttribute("data-form-address-initialised")).toBe(false);
  });

  it("does nothing if no address_search input", async () => {
    const el = document.createElement("form");
    el.setAttribute("data-form-address", "");

    const { initAddressForms } = await import("../address.js");
    initAddressForms(el);
    expect(el.hasAttribute("data-form-address-initialised")).toBe(false);
  });

  it("skips if already initialised", async () => {
    formEl.setAttribute("data-form-address-initialised", "true");
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);
    const suggestions = formEl.querySelector("[data-form-address-suggestions]");
    expect(suggestions).toBeNull();
  });

  it("builds suggestions container on init", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);
    const wrap = formEl.querySelector("[data-form-address-suggestions]");
    expect(wrap).not.toBeNull();
    expect(wrap.hidden).toBe(true);
    expect(wrap.querySelector("ul")).not.toBeNull();
    expect(formEl.querySelector('[name="address_line_2"]').getAttribute("data-form-field-required")).toBe("false");
  });

  it("defaults UK-only country on init", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    expect(formEl.querySelector('[name="country"]').value).toBe("United Kingdom");
  });

  it("configures manual address fields for browser autofill and validation", async () => {
    const { formFields } = await import("../core.js");
    formEl.querySelectorAll("input").forEach((input) => formFields.applyFieldType(input));

    expect(formEl.querySelector('[name="address_search"]').getAttribute("autocomplete")).toBe("off");
    expect(formEl.querySelector('[name="address_line_1"]').getAttribute("autocomplete")).toBe("address-line1");
    expect(formEl.querySelector('[name="address_line_2"]').getAttribute("autocomplete")).toBe("address-line2");
    expect(formEl.querySelector('[name="town_city"]').getAttribute("autocomplete")).toBe("address-level2");
    expect(formEl.querySelector('[name="county"]').getAttribute("autocomplete")).toBe("address-level1");
    expect(formEl.querySelector('[name="postcode"]').getAttribute("autocomplete")).toBe("postal-code");
    expect(formEl.querySelector('[name="country"]').getAttribute("autocomplete")).toBe("country-name");
  });

  it("hides and clears an existing Webflow suggestions wrapper on init", async () => {
    const select = document.createElement("div");
    select.setAttribute("data-form-select", "");
    select.setAttribute("data-form-state", "open");
    const wrap = document.createElement("div");
    wrap.setAttribute("data-form-address-suggestions", "");
    wrap.hidden = false;
    wrap.innerHTML = '<ul><li data-form-select-option="stale">Stale</li></ul>';
    select.appendChild(wrap);
    formEl.insertBefore(select, searchInput.nextSibling);

    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    expect(select.hasAttribute("data-form-state")).toBe(false);
    expect(wrap.hidden).toBe(true);
    expect(wrap.querySelectorAll("[data-form-select-option]")).toHaveLength(0);
  });

  it("fills canonical courier address fields when a suggestion is selected", async () => {
    vi.useFakeTimers();
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.focus();
    searchInput.value = "12 high";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);

    const option = formEl.querySelector("[data-form-select-option]");
    const wrap = formEl.querySelector("[data-form-address-suggestions]");
    expect(option).not.toBeNull();
    expect(wrap.hidden).toBe(false);
    expect(option.querySelector("[data-suggestion-main]").textContent).toBe("12 High Street.");
    expect(option.querySelector("[data-suggestion-sub]").textContent).toBe("London, SW1A 1AA");

    option.click();
    expect(wrap.hidden).toBe(true);
    expect(wrap.querySelectorAll("[data-form-select-option]")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(wrap.querySelectorAll("[data-form-select-option]")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);

    expect(formEl.querySelector('[name="address_line_1"]').value).toBe("12 High Street");
    expect(formEl.querySelector('[name="address_line_2"]').value).toBe("");
    expect(formEl.querySelector('[name="address_search"]').value).toBe("12 High Street, London, SW1A 1AA");
    expect(formEl.querySelector('[name="town_city"]').value).toBe("London");
    expect(formEl.querySelector('[name="county"]').value).toBe("Greater London");
    expect(formEl.querySelector('[name="postcode"]').value).toBe("SW1A 1AA");
    expect(formEl.querySelector('[name="country"]').value).toBe("United Kingdom");
    expect(wrap.hidden).toBe(true);
    expect(wrap.querySelectorAll("[data-form-select-option]")).toHaveLength(0);
  });

  it("submits canonical address fields and keeps address_search enabled", async () => {
    vi.useFakeTimers();
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.focus();
    searchInput.value = "12 high";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);

    formEl.querySelector("[data-form-select-option]").click();
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(400);

    const { formFields } = await import("../core.js");
    formFields.render({ root: formEl, steps: [] });
    const submitted = submittedFields(formEl);

    expect(submitted.address_line_1).toBe("12 High Street");
    expect(submitted.address_line_2).toBe("");
    expect(submitted.town_city).toBe("London");
    expect(submitted.county).toBe("Greater London");
    expect(submitted.postcode).toBe("SW1A 1AA");
    expect(submitted.country).toBe("United Kingdom");
    expect(submitted.address_search).toBe("12 High Street, London, SW1A 1AA");
    expect(submitted.address_mode).toBe("found");
  });

  it("fills canonical courier fields from Google place details using postal_town", async () => {
    vi.useFakeTimers();
    const { formConfig } = await import("../config.js");
    formConfig.address.demo = false;
    formConfig.address.googlePlacesApiKey = "test-key";

    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("places:autocomplete")) {
        return new Response(JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: "places/test",
                structuredFormat: {
                  mainText: { text: "Victoria Street" },
                  secondaryText: { text: "London SW1E 6RD" },
                },
              },
            },
          ],
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        addressComponents: [
          { longText: "SW1E 6RD", types: ["postal_code"] },
          { longText: "Victoria Street", types: ["route"] },
          { longText: "London", types: ["postal_town"] },
          { longText: "Greater London", types: ["administrative_area_level_2", "political"] },
          { longText: "United Kingdom", types: ["country", "political"] },
        ],
      }), { status: 200 });
    }));

    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.focus();
    searchInput.value = "SW1E 6RD";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);

    const option = formEl.querySelector("[data-form-select-option]");
    expect(option).not.toBeNull();
    option.click();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(formEl.querySelector('[name="address_line_1"]').value).toBe("Victoria Street");
    expect(formEl.querySelector('[name="address_line_2"]').value).toBe("");
    expect(formEl.querySelector('[name="town_city"]').value).toBe("London");
    expect(formEl.querySelector('[name="county"]').value).toBe("Greater London");
    expect(formEl.querySelector('[name="postcode"]').value).toBe("SW1E 6RD");
    expect(formEl.querySelector('[name="country"]').value).toBe("United Kingdom");
  });

  it("falls back to town/city when Google does not return a county component", async () => {
    vi.useFakeTimers();
    const { formConfig } = await import("../config.js");
    formConfig.address.demo = false;
    formConfig.address.googlePlacesApiKey = "test-key";

    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("places:autocomplete")) {
        return new Response(JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: "places/no-county",
                structuredFormat: {
                  mainText: { text: "10 Downing Street" },
                  secondaryText: { text: "London SW1A 2AA" },
                },
              },
            },
          ],
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        addressComponents: [
          { longText: "10", types: ["street_number"] },
          { longText: "Downing Street", types: ["route"] },
          { longText: "London", types: ["postal_town"] },
          { longText: "SW1A 2AA", types: ["postal_code"] },
          { longText: "United Kingdom", types: ["country", "political"] },
        ],
      }), { status: 200 });
    }));

    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.focus();
    searchInput.value = "10 Downing";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);

    formEl.querySelector("[data-form-select-option]").click();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(formEl.querySelector('[name="town_city"]').value).toBe("London");
    expect(formEl.querySelector('[name="county"]').value).toBe("London");
    expect(formEl.querySelector('[name="postcode"]').value).toBe("SW1A 2AA");
  });

  it("splits Google subpremise into address lines", async () => {
    vi.useFakeTimers();
    const { formConfig } = await import("../config.js");
    formConfig.address.demo = false;
    formConfig.address.googlePlacesApiKey = "test-key";

    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("places:autocomplete")) {
        return new Response(JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: "places/flat",
                structuredFormat: {
                  mainText: { text: "flat 2, 127 Victoria Street" },
                  secondaryText: { text: "London SW1E 6RD, UK" },
                },
                text: { text: "flat 2, 127 Victoria Street, London SW1E 6RD, UK" },
              },
            },
          ],
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        addressComponents: [
          { longText: "flat 2", types: ["subpremise"] },
          { longText: "127", types: ["street_number"] },
          { longText: "Victoria Street", types: ["route"] },
          { longText: "London", types: ["postal_town"] },
          { longText: "Greater London", types: ["administrative_area_level_2", "political"] },
          { longText: "United Kingdom", types: ["country", "political"] },
          { longText: "SW1E 6RD", types: ["postal_code"] },
        ],
      }), { status: 200 });
    }));

    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.focus();
    searchInput.value = "flat 2 victoria";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);

    const option = formEl.querySelector("[data-form-select-option]");
    expect(option.querySelector("[data-suggestion-main]").textContent).toBe("flat 2, 127 Victoria Street.");
    expect(option.querySelector("[data-suggestion-sub]").textContent).toBe("London SW1E 6RD, UK");
    option.click();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(formEl.querySelector("[data-form-address-suggestions]").querySelectorAll("[data-form-select-option]")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(formEl.querySelector("[data-form-address-suggestions]").querySelectorAll("[data-form-select-option]")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);

    // With no dedicated house_number field on this form, the premises identifier
    // folds onto Line 1 so nothing is dropped.
    expect(formEl.querySelector('[name="address_line_1"]').value).toBe("flat 2, 127 Victoria Street");
    expect(formEl.querySelector('[name="address_line_2"]').value).toBe("");
    expect(formEl.querySelector('[name="address_search"]').value).toBe("flat 2, 127 Victoria Street, London SW1E 6RD, UK");
    expect(formEl.querySelector("[data-form-address-suggestions]").hidden).toBe(true);
  });

  it("closes suggestions when clicking outside", async () => {
    vi.useFakeTimers();
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.focus();
    searchInput.value = "12 high";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);

    const wrap = formEl.querySelector("[data-form-address-suggestions]");
    expect(wrap.hidden).toBe(false);

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(wrap.hidden).toBe(true);
    expect(wrap.querySelectorAll("[data-form-select-option]")).toHaveLength(0);
  });

  it("clicking manual trigger hides search and copies value to address_line_1", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.value = "My custom address";
    manualBtn.click();

    expect(searchInput.hidden).toBe(true);
    const addr1 = formEl.querySelector('[name="address_line_1"]');
    expect(addr1).not.toBeNull();
    expect(addr1.value).toBe("My custom address");
    expect(formEl.querySelector('[name="country"]').value).toBe("United Kingdom");
  });

  it("routes a postcode-only search to the postcode field (not Line 1) on manual switch", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    // User searches by postcode, picks no suggestion, then switches to manual:
    // the postcode must not satisfy the required Line 1 field.
    searchInput.value = "nw2 1dl";
    manualBtn.click();

    expect(formEl.querySelector('[name="address_line_1"]').value).toBe("");
    expect(formEl.querySelector('[name="postcode"]').value).toBe("NW2 1DL");
  });

  it("normalises a spaceless postcode when routing on manual switch", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.value = "Nw21DL";
    manualBtn.click();

    expect(formEl.querySelector('[name="postcode"]').value).toBe("NW2 1DL");
    expect(formEl.querySelector('[name="address_line_1"]').value).toBe("");
  });

  it("prefills nothing on manual switch when the search is empty (Line 1 stays required)", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.value = "";
    manualBtn.click();

    expect(formEl.querySelector('[name="address_line_1"]').value).toBe("");
    expect(formEl.querySelector('[name="postcode"]').value).toBe("");
  });

  it("normalises a directly-typed postcode on blur", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    const pc = formEl.querySelector('[name="postcode"]');
    pc.value = "sw1a1aa";
    pc.dispatchEvent(new Event("blur"));

    expect(pc.value).toBe("SW1A 1AA");
  });

  // --- adversarial / edge cases ---------------------------------------------

  it("handles the short (5-char) and GIR special postcodes on manual switch", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    for (const [typed, expected] of [["m1 1aa", "M1 1AA"], ["gir 0aa", "GIR 0AA"], ["ec1a1bb", "EC1A 1BB"]]) {
      formEl.querySelector('[name="postcode"]').value = "";
      formEl.querySelector('[name="address_line_1"]').value = "";
      searchInput.value = typed;
      manualBtn.click();
      expect(formEl.querySelector('[name="postcode"]').value).toBe(expected);
      expect(formEl.querySelector('[name="address_line_1"]').value).toBe("");
    }
  });

  it("does NOT divert a full address string (postcode-in-context) to the postcode field", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.value = "12 High Street, London, NW2 1DL";
    manualBtn.click();

    // Not a bare postcode -> stays a Line 1 prefill
    expect(formEl.querySelector('[name="address_line_1"]').value).toBe("12 High Street, London, NW2 1DL");
    expect(formEl.querySelector('[name="postcode"]').value).toBe("");
  });

  it("prefills nothing for a whitespace-only search on manual switch", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.value = "   ";
    manualBtn.click();

    expect(formEl.querySelector('[name="address_line_1"]').value).toBe("");
    expect(formEl.querySelector('[name="postcode"]').value).toBe("");
  });

  it("leaves a partial/invalid postcode untouched on blur (so validation still fires)", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    const pc = formEl.querySelector('[name="postcode"]');
    pc.value = "NW2";
    pc.dispatchEvent(new Event("blur"));
    expect(pc.value).toBe("NW2");
  });

  it("falls back to Line 1 for a postcode when the form has no postcode field", async () => {
    formEl.querySelector('[name="postcode"]').remove();
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.value = "NW2 1DL";
    expect(() => manualBtn.click()).not.toThrow();
    // No postcode field to route to -> value kept in Line 1
    expect(formEl.querySelector('[name="address_line_1"]').value).toBe("NW2 1DL");
  });

  // --- dedicated house_number field (present) -------------------------------

  function addHouseNumberField() {
    const el = document.createElement("input");
    el.name = "house_number";
    formEl.insertBefore(el, formEl.querySelector('[name="address_line_1"]'));
    return el;
  }

  it("splits number to house_number and street to Line 1 when the field exists (full address)", async () => {
    vi.useFakeTimers();
    addHouseNumberField();
    const { formConfig } = await import("../config.js");
    formConfig.address.demo = false;
    formConfig.address.googlePlacesApiKey = "test-key";

    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("places:autocomplete")) {
        return new Response(JSON.stringify({ suggestions: [{ placePrediction: { placeId: "places/x",
          structuredFormat: { mainText: { text: "10 Downing Street" }, secondaryText: { text: "London SW1A 2AA" } } } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ addressComponents: [
        { longText: "10", types: ["street_number"] },
        { longText: "Downing Street", types: ["route"] },
        { longText: "London", types: ["postal_town"] },
        { longText: "SW1A 2AA", types: ["postal_code"] },
        { longText: "United Kingdom", types: ["country", "political"] },
      ] }), { status: 200 });
    }));

    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);
    searchInput.focus();
    searchInput.value = "10 Downing";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);
    formEl.querySelector("[data-form-select-option]").click();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(formEl.querySelector('[name="house_number"]').value).toBe("10");
    expect(formEl.querySelector('[name="address_line_1"]').value).toBe("Downing Street");
    expect(formEl.querySelector('[name="address_line_1_combined"]').value).toBe("10 Downing Street");
  });

  it("leaves house_number empty for a postcode/street-level pick and combines what's there", async () => {
    vi.useFakeTimers();
    addHouseNumberField();
    const { formConfig } = await import("../config.js");
    formConfig.address.demo = false;
    formConfig.address.googlePlacesApiKey = "test-key";

    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("places:autocomplete")) {
        return new Response(JSON.stringify({ suggestions: [{ placePrediction: { placeId: "places/pc",
          structuredFormat: { mainText: { text: "Bath Road" }, secondaryText: { text: "Reading RG1 6NS" } } } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ addressComponents: [
        { longText: "Bath Road", types: ["route"] },
        { longText: "Reading", types: ["postal_town"] },
        { longText: "RG1 6NS", types: ["postal_code"] },
        { longText: "United Kingdom", types: ["country", "political"] },
      ] }), { status: 200 });
    }));

    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);
    searchInput.focus();
    searchInput.value = "RG1 6NS";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);
    formEl.querySelector("[data-form-select-option]").click();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(formEl.querySelector('[name="house_number"]').value).toBe("");
    expect(formEl.querySelector('[name="address_line_1"]').value).toBe("Bath Road");
    expect(formEl.querySelector('[name="address_line_1_combined"]').value).toBe("Bath Road");

    const house = formEl.querySelector('[name="house_number"]');
    house.value = "42";
    house.dispatchEvent(new Event("input", { bubbles: true }));
    expect(formEl.querySelector('[name="address_line_1_combined"]').value).toBe("42 Bath Road");
  });

  it("does not create a combined field on forms without a house_number field", async () => {
    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);
    expect(formEl.querySelector('[name="address_line_1_combined"]')).toBeNull();
  });

  it("clicking automatic trigger restores address search", async () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-form-field", "");
    formEl.insertBefore(wrapper, searchInput);
    wrapper.appendChild(searchInput);

    const { initAddressForms } = await import("../address.js");
    initAddressForms(formEl);

    searchInput.value = "My custom address";
    manualBtn.click();
    expect(wrapper.hidden).toBe(true);
    expect(searchInput.hidden).toBe(true);

    autoBtn.click();

    expect(wrapper.hidden).toBe(false);
    expect(searchInput.hidden).toBe(false);
    expect(document.activeElement).toBe(searchInput);
  });
});
