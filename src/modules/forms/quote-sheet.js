// Price estimate PDF — the gold calculator's "Download price estimate" link.
//
// The PDF is made by the suttons-quote Worker (private repo, quote/). This file
// only gathers what the page shows into one string, `d`, and hands it over:
//
//   on click   the link opens WORKER/quote?d=... in a new tab. No reference: the
//              customer can download from step 1, before any enquiry exists.
//   on submit  a beacon stores d under the lead reference, and the hidden field
//              quote_pdf_url carries WORKER/quote/<reference> to Zapier, so the
//              Zoho lead links to the same sheet. Nothing waits: the link is
//              known before the beacon lands, and submit is never delayed.
//
// THE SHEET SHOWS WHAT THE PAGE SHOWS. Items come from the hidden fields gold.js
// rewrites on every recalculation (the same fields Zoho receives), formatted
// with the page's own formatter. Estimate rows are the ones the Price estimate
// panel is showing, so its show-if rules (Loan: loan only, Sell: both, not yet
// chosen: price of your gold today) decide the sheet too. Nothing is priced here.
//
// Link visibility is Designer-only: show-if "gold_purchase_total > 0" on the
// link, so it appears once an item is priced. The Price estimate panel is
// already hidden on the Describe items route, so the link is too.

import { formConfig } from "./config.js";
import { formDom } from "./core/dom.js";
import { formValues } from "./core/values.js";
import { MANUAL_QUOTE_PROMPT } from "./gold.js";
import { formatMoney } from "./numbers.js";

const LINK = "[data-form-gold-quote-link]";
const PANEL = "[data-form-gold-section-price]";
// The estimate outputs the Worker has labels for (quote/src/data.js TOTALS).
const TOTALS = new Set(["indicative_value", "purchase_total", "loan_total"]);

function field(root, name) {
  return String(root.querySelector(`[name="${name}"]`)?.value || "").trim();
}

// Whole pounds exactly as the page formats them; blank rather than "£0" when
// the calculator produced no figure.
function money(value) {
  const number = Number(value);
  return value !== "" && Number.isFinite(number) ? formatMoney(number) : "";
}

// Priced slots, in order. gold.js writes bullion_name_N for every slot it
// priced and blanks the rest, so it doubles as the presence test.
function items(root) {
  return Array.from(root.querySelectorAll('[name^="bullion_name_"]'))
    .filter((input) => input.value.trim())
    .map((input) => Number(input.name.slice("bullion_name_".length)))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
    .map((n) => [
      field(root, `gold_item_${n}_label`),
      field(root, `gold_item_${n}_type`),
      field(root, `gold_item_${n}_weight_grams`),
      field(root, `gold_item_${n}_quantity`),
      field(root, `gold_item_${n}_manual`) === "true"
        ? MANUAL_QUOTE_PROMPT
        : money(field(root, `gold_item_${n}_amount`)),
    ]);
}

function totals(root) {
  return Array.from(root.querySelectorAll(`${PANEL} [data-form-gold-output]`))
    .filter((el) => TOTALS.has(el.getAttribute("data-form-gold-output")) && !formDom.isConditionHidden(el))
    .map((el) => [el.getAttribute("data-form-gold-output"), el.textContent.trim()]);
}

// enquiry_type is a radio group, so the checked one; "" until answered.
function enquiry(root) {
  return String(root.querySelector('[name="enquiry_type"]:checked')?.value || "").trim();
}

export function readQuote(root) {
  return { e: enquiry(root), i: items(root), t: totals(root) };
}

// base64url of the UTF-8 JSON: the figures carry "£".
export function encodeQuote(quote) {
  const bytes = new TextEncoder().encode(JSON.stringify(quote));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const worker = () => formConfig.quote.workerBase;

export function initQuoteSheet() {
  if (typeof document === "undefined") return;

  // Set the address at the moment of the click, so it is always the figures
  // on screen; the browser then follows the link as normal.
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.(LINK);
    const root = link?.closest("form");
    if (!root) return;
    link.target = "_blank";
    link.rel = "noopener";
    link.href = `${worker()}/quote?d=${encodeQuote(readQuote(root))}`;
  }, true);

  // Fired inside the form's capture-phase submit handler, after the lead
  // reference is set and before Webflow reads the fields (core/events.js).
  document.addEventListener("suttons:form-submit", (event) => {
    const root = event.target;
    if (!root?.matches?.('[data-form="gold"]')) return;
    const reference = field(root, "lead_reference");
    const quote = readQuote(root);
    if (!reference || !quote.i.length) {
      formValues.setHidden(root, "quote_pdf_url", "");
      return;
    }
    const url = `${worker()}/quote/${encodeURIComponent(reference)}`;
    formValues.setHidden(root, "quote_pdf_url", url);
    navigator.sendBeacon?.(url, encodeQuote(quote));
  });
}
