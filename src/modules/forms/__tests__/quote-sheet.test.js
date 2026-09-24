import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeQuote, initQuoteSheet, readQuote } from "../quote-sheet.js";
import { formConfig } from "../config.js";
import { MANUAL_QUOTE_PROMPT } from "../gold.js";

const WORKER = formConfig.quote.workerBase;

// A priced jewellery item plus a Sovereign, at the figures the calculator
// produced on the site on 9 Sep 2026 at £104.40 spot.
const TWO_ITEMS = {
  lead_reference: "BURGE-R625-FPWN",
  bullion_name_1: "18ct Gold Jewellery",
  gold_item_1_label: "18ct",
  gold_item_1_type: "Jewellery",
  gold_item_1_weight_grams: "15",
  gold_item_1_quantity: "1",
  gold_item_1_amount: "855",
  gold_item_1_loan_value: "760",
  gold_item_1_manual: "false",
  bullion_name_2: "Gold Sovereign",
  gold_item_2_label: "Gold Sovereign",
  gold_item_2_type: "Coin",
  gold_item_2_weight_grams: "7.99",
  gold_item_2_quantity: "1",
  gold_item_2_amount: "1556",
  gold_item_2_loan_value: "1400",
  gold_item_2_manual: "false",
  bullion_name_3: "",
};

// The Price estimate panel's three outputs and their show-if wrappers, as in
// the Gold Form component on 23 Sep 2026.
const PANEL = `
  <div data-form-gold-section-price="true">
    <div data-form-show-if="enquiry_type =" data-form-state="__NOANSWER__">
      <p data-form-gold-output="indicative_value">£2,700</p></div>
    <div data-form-show-if="enquiry_type = Sell My Items" data-form-state="__SELL__">
      <p data-form-gold-output="purchase_total">£2,700</p></div>
    <div><p data-form-gold-output="loan_total">£2,411</p></div>
  </div>
  <a href="#" data-form-gold-quote-link>Download price estimate</a>`;

function buildForm(fields, { enquiry = "Loan", key = "gold" } = {}) {
  const hide = (shown) => (shown ? "" : "condition-hidden");
  const form = document.createElement("form");
  form.setAttribute("data-form", key);
  // The enquiry question as on the site: a radio group, Loan first.
  const radios = ["Loan", "Sell My Items"]
    .map((v) => `<input type="radio" name="enquiry_type" value="${v}"${v === enquiry ? " checked" : ""}>`)
    .join("");
  form.innerHTML = radios + Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${value}">`)
    .join("") + PANEL
    .replace("__NOANSWER__", hide(enquiry === ""))
    .replace("__SELL__", hide(enquiry === "Sell My Items"));
  document.body.append(form);
  return form;
}

// The Worker's decoder, inlined: what the site sends must survive the trip.
const decode = (d) =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(d.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));

beforeEach(() => { document.body.innerHTML = ""; });

describe("readQuote", () => {
  it("reads the items from the hidden fields, formatted as the page formats them", () => {
    expect(readQuote(buildForm(TWO_ITEMS, { enquiry: "Sell My Items" })).i).toEqual([
      ["18ct", "Jewellery", "15", "1", "£855"],
      ["Gold Sovereign", "Coin", "7.99", "1", "£1,556"],
    ]);
  });

  it("skips slots gold.js left blank", () => {
    expect(readQuote(buildForm(TWO_ITEMS)).i).toHaveLength(2);
  });

  it("gives an unpriced row the page's own prompt, never a figure", () => {
    const form = buildForm({ ...TWO_ITEMS, gold_item_2_manual: "true", gold_item_2_amount: "0" });
    expect(readQuote(form).i[1][4]).toBe(MANUAL_QUOTE_PROMPT);
  });

  it.each([
    ["Loan", [["loan_total", "£2,411"]]],
    ["Sell My Items", [["purchase_total", "£2,700"], ["loan_total", "£2,411"]]],
    ["", [["indicative_value", "£2,700"], ["loan_total", "£2,411"]]],
  ])("takes the estimate rows the panel is showing for enquiry %j", (enquiry, rows) => {
    const form = buildForm(TWO_ITEMS, { enquiry });
    expect(readQuote(form).t).toEqual(rows);
  });

  it.each([["Loan"], ["Sell My Items"], [""]])("reads the checked enquiry, not the first radio: %j", (enquiry) => {
    expect(readQuote(buildForm(TWO_ITEMS, { enquiry })).e).toBe(enquiry);
  });

  it("shows each item's loan value when the panel shows the loan amount alone, so rows add up", () => {
    const panelLoanOnly = buildForm(TWO_ITEMS, { enquiry: "Loan" });
    expect(readQuote(panelLoanOnly).i.map((row) => row[4])).toEqual(["£760", "£1,400"]);
    const panelBoth = buildForm(TWO_ITEMS, { enquiry: "Sell My Items" });
    expect(readQuote(panelBoth).i.map((row) => row[4])).toEqual(["£855", "£1,556"]);
  });

  it("encodes to base64url that decodes back to the same figures, £ included", () => {
    const quote = readQuote(buildForm(TWO_ITEMS));
    const d = encodeQuote(quote);
    expect(d).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decode(d)).toEqual(quote);
  });
});

describe("the link and the submit", () => {
  let beacon;
  beforeEach(() => {
    beacon = vi.fn(() => true);
    navigator.sendBeacon = beacon;
  });
  afterEach(() => { delete navigator.sendBeacon; });

  initQuoteSheet();

  const submit = (form) => form.dispatchEvent(new CustomEvent("suttons:form-submit", { bubbles: true }));
  const hidden = (form) => form.querySelector('[name="quote_pdf_url"]')?.value;

  it("points the link at the figures on screen when clicked, with no reference", () => {
    const form = buildForm(TWO_ITEMS);
    const link = form.querySelector("[data-form-gold-quote-link]");
    link.addEventListener("click", (e) => e.preventDefault());
    link.click();
    const url = new URL(link.href);
    expect(`${url.origin}${url.pathname}`).toBe(`${WORKER}/quote`);
    expect(decode(url.searchParams.get("d"))).toEqual(readQuote(form));
    expect(link.href).not.toContain("BURGE");
  });

  it.each(["pointerdown", "contextmenu", "focusin"])("sets the address on %s too, so right-click and long-press open the PDF", (type) => {
    const form = buildForm(TWO_ITEMS);
    const link = form.querySelector("[data-form-gold-quote-link]");
    link.dispatchEvent(new Event(type, { bubbles: true }));
    expect(link.getAttribute("href")).toMatch(new RegExp(`^${WORKER}/quote\\?d=`));
  });

  it("sends the Zoho link and beacons the same figures at submit, without waiting", () => {
    const form = buildForm(TWO_ITEMS);
    submit(form);
    expect(hidden(form)).toBe(`${WORKER}/quote/BURGE-R625-FPWN`);
    expect(beacon).toHaveBeenCalledWith(`${WORKER}/quote/BURGE-R625-FPWN`, encodeQuote(readQuote(form)));
  });

  it("sends no link and no beacon when nothing is priced (the Describe items route)", () => {
    const blank = Object.fromEntries(Object.keys(TWO_ITEMS).map((k) => [k, k === "lead_reference" ? "BURGE-R625-FPWN" : ""]));
    const form = buildForm(blank);
    submit(form);
    expect(hidden(form)).toBe("");
    expect(beacon).not.toHaveBeenCalled();
  });

  it("leaves other forms alone", () => {
    const form = buildForm(TWO_ITEMS, { key: "get-a-quote" });
    submit(form);
    expect(hidden(form)).toBeUndefined();
    expect(beacon).not.toHaveBeenCalled();
  });
});
