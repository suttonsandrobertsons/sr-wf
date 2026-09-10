// "Print my Quote" — renders the one-page gold quote and hands it to the
// browser's print dialog, which is also where Save as PDF lives.
//
// WHY AN IFRAME. The sheet is a self-contained document with its own stylesheet,
// written into an off-screen iframe. The site ships ~268KB of CSS; printing a
// block that lives in the page would mean overriding all of it, and the client
// explicitly did not want "the web page sent to a printer". A separate document
// inherits nothing, so what prints is only ever this layout.
//
// WHY NO SERVER. The client does not need a stored copy (confirmed 9 Sep 2026),
// so there is nothing for a Worker route to do that the browser cannot. That
// decision is what keeps this to one file with no dependency: no pdf-lib, no
// font subsetting, no rasterised logo, no CORS.
//
// Values are read from the form's own hidden fields rather than passed in, so
// this module cannot disagree with what is about to be submitted — the fields
// are rewritten on every recalculation by gold.js persistItemSlotFields.
//
// THE SHEET DOES NO ARITHMETIC. Every figure it prints is a hidden field value
// that has already been through the calculator's own rounding: MROUND to 50p
// per gram and per unit for jewellery, once per unit for coins and bars, then
// roundWholePound for the Zoho-facing field. Nothing is recomputed here, so
// the 50p model cannot drift between the screen, the sheet and the CRM.
//
// ANYTHING THE PAGE SHOWS, THE SHEET SHOWS THE SAME WAY — same value, same
// format, same casing, same wording. Censused against the live calculator on
// 9 Sep 2026, the page displays exactly three figures and their labels:
//
//   per item   `subtotal`        labelled "TOTAL:"           money, 0dp
//   summary    `purchase_total`  labelled "Purchase Amount"  money, 0dp
//   summary    `loan_total`      labelled "Loan Amount"      money, 0dp
//              under the heading "Price Estimate"
//
// The per-item figure is ONE number, not two: getDisplayValue picks loan for a
// loan enquiry, purchase for a sale, and the higher of the two when neither is
// answered yet. `gold_item_N_amount` is written from that same function, so
// printing it is the only way the row can agree with the row the customer read.
// Printing purchase AND loan per item would show a figure the page never did.
//
// The item's own wording is `gold_item_N_label` — the option text as it appears
// in the dropdown ("18ct", "Gold Sovereign") — not `bullion_name_N`, which is
// the Zoho-facing composition ("18ct Gold") and appears on no screen. An
// unpriced row carries the page's own prompt rather than wording of our own.
//
// A figure the page does not display is not printed at all, and nothing is
// written to stand in for it. The gold price is the case that matters: it is
// the basis of every number here, but the customer is never shown it, so
// printing it would put a value on the sheet they cannot check — and narrating
// it in a footnote means writing copy the site does not have. See the note
// above the constants.
//
// Weight and quantity ARE printed, because the customer typed them: they are
// shown exactly as entered rather than through formatNumber, which would round
// 7.99g to 8g.

import { MANUAL_QUOTE_PROMPT } from "./gold.js";
import { formatMoney } from "./numbers.js";

const TRIGGER = "[data-form-gold-print]";

// The enquiry radios submit Zoho's values; these are the customer-facing labels
// from the form itself, so the sheet reads the way the page did.
const ENQUIRY_LABELS = {
  Loan: "Loan against item",
  "Sell My Items": "Sell my item",
};

// EVERY STRING THE SHEET PRINTS IS QUOTED FROM THE SITE. Nothing here is
// written for the sheet: a printed document in the client's name is not the
// place to introduce a sentence their own copy does not contain, and a
// valuation is not the place to introduce a caveat their legal wording does
// not. Each constant below records where its text is taken from, so a copy
// change on the site can be traced to the line that needs following.

// Imported, not copied. gold.js owns this sentence and puts it in place of an
// unpriced row's figure on screen; a second literal here would let the sheet
// drift away from the page on the next copy change.
const MANUAL_PROMPT = MANUAL_QUOTE_PROMPT;

// THERE IS NO CAVEAT LINE, and adding one is not a formatting decision.
//
// The gold price is not printed: the calculator never displays it, so a figure
// here would be one the customer was never shown and cannot check. The obvious
// substitute was /sell-gold's "Spot price: your offer is based on the live gold
// price on the day" — and quoting it was wrong on five counts. It is the fourth
// bullet of a four-bullet list (Purity / Type / Weight / Spot price) explaining
// how a specialist values gold in person; alone at the foot of a document it
// reads as a validity disclaimer, which is not what it is. "Your offer" means a
// specialist's offer after inspection, where this sheet carries an estimate.
// "On the day" is unambiguous on a web page and ambiguous on paper — printed,
// or presented? The "Spot price:" label labels nothing once the figure is gone.
// And it is sell-side copy that would print on a loan quote.
//
// Word-level provenance is not the test. Lifting a real sentence into a place
// that changes what it means is writing new copy with extra steps.
//
// The site has no wording about what a quote is worth or how long it holds —
// searched for "valid", "subject to", "indicative", "guarantee", and the
// calculator form carries no caveat at all. The page's own qualifier is the
// heading it puts above the figures: "Price Estimate". That is what the sheet
// uses, and nothing more. Any caveat beyond it is new copy, and on the loan
// side likely a compliance question, so it comes from the client or not at all.

// The site footer, verbatim, including its own punctuation and its lowercase
// "limited" in the second mention. Read from the live footer on 9 Sep 2026.
const LEGAL =
  "\u00a92026 Suttons & Robertsons \u2013 all rights reserved. Suttons & Robertsons is a " +
  "trading name of Hopkins & Jones Limited who are authorised and regulated by the " +
  "Financial Conduct Authority. Firm reference number 731198. " +
  "www.suttonsandrobertsons.com is a site operated by Hopkins & Jones limited, trading " +
  "as Suttons & Robertsons, S&R Jewellers, Robertsons and Hopkins & Jones, registered " +
  "in England under company number 433606. Registered office: 127 Victoria Street, " +
  "London SW1E 6RD. VAT number: GB23828037.";

// The number in the site header, on this page and every other.
const PHONE = "0800 182 2330";

const LOGO_SRC =
  "https://cdn.prod.website-files.com/69f9fedf076067055e5a003f/6a0d90563499d746736461af_logo.svg";
const FONTS =
  "https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500&family=Jost:wght@300;400;500&display=swap";

function field(root, name) {
  const el = root.querySelector(`[name="${name}"]`);
  return el ? String(el.value || "").trim() : "";
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
  ));
}

// Blank rather than "£0" for an absent value: an empty hidden field means the
// calculator produced no figure, which is not the same as a figure of nothing.
function money(value) {
  const number = Number(value);
  return Number.isFinite(number) && value !== "" ? formatMoney(number) : "";
}

// Today, in the format the rest of the site uses.
function today() {
  return new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
}

// The slots the form actually carries, in order. Read from the DOM rather than
// against a MAX_ITEMS of our own: the cap lives in the Designer markup as
// data-form-gold-max-items, so a second copy of "5" here would silently drop
// item 6 the day the client raises it.
function itemSlots(root) {
  const found = [];
  root.querySelectorAll('[name^="bullion_name_"]').forEach((input) => {
    const index = Number(input.getAttribute("name").slice("bullion_name_".length));
    // bullion_name_N doubles as the presence test: gold.js writes it for every
    // slot it priced and blanks it for the rest.
    if (Number.isInteger(index) && index > 0 && String(input.value || "").trim()) {
      found.push(index);
    }
  });
  return found.sort((a, b) => a - b);
}

function readItems(root) {
  const items = [];
  for (const index of itemSlots(root)) {
    items.push({
      // The dropdown's own option text, which is what the customer chose.
      label: field(root, `gold_item_${index}_label`),
      type: field(root, `gold_item_${index}_type`),
      weight: field(root, `gold_item_${index}_weight_grams`),
      quantity: field(root, `gold_item_${index}_quantity`),
      // The one per-item figure the page shows, from the same getDisplayValue
      // branch its "TOTAL:" is rendered from.
      amount: field(root, `gold_item_${index}_amount`),
      // A row the calculator could not price — an unlisted coin or bar, or
      // "I'm not sure". Printing £0 beside a real item would read as an offer.
      manual: field(root, `gold_item_${index}_manual`) === "true",
    });
  }
  return items;
}

function readQuote(root) {
  return {
    reference: field(root, "lead_reference"),
    date: today(),
    enquiry: ENQUIRY_LABELS[field(root, "enquiry_type")] || "",
    // Over the top rate band there is no loan on offer; the calculator writes
    // "Enquire" into its loan-terms outputs rather than a number. The sheet
    // has no terms block, so without this it would print a bare five-figure
    // loan the business will not make.
    aboveMax: field(root, "gold_is_above_max") === "true",
    purchaseTotal: field(root, "gold_purchase_total"),
    loanTotal: field(root, "gold_loan_total"),
    items: readItems(root),
  };
}

function itemRow(item) {
  // The page replaces an unpriced row's "TOTAL:" with this exact sentence
  // (gold.js getItemPrompt). Inventing our own wording here — "requires
  // inspection", say — would be the sheet saying something the site does not.
  const figure = item.manual
    ? `<td class="prompt">${esc(MANUAL_PROMPT)}</td>`
    : `<td class="num">${esc(money(item.amount))}</td>`;

  return `<tr>
    <td><div class="desc">${esc(item.label)}</div>
        <div class="descsub">${esc(item.type)}</div></td>
    <td class="num">${esc(item.weight)}</td>
    <td class="num">${esc(item.quantity)}</td>
    ${figure}
  </tr>`;
}

function sheet(quote) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Gold calculator — ${esc(quote.reference)}</title>
<link rel="stylesheet" href="${FONTS}">
<style>
  /* The print margin lives on @page so the browser owns it. Screen padding is
     separate and screen-only, or the sheet renders flush to the edge in a
     preview and gets double margins when printed. */
  @page { size: A4; margin: 16mm 15mm }
  @media screen {
    html { background:#f4f4f6; padding:24px 0 }
    body { width:210mm; min-height:297mm; margin:0 auto; padding:16mm 15mm;
           background:#fff; box-shadow:0 1px 24px rgba(17,20,32,.14) }
  }
  :root { --navy:#262c46; --midnight:#111420; --gold:#ae9a64; --rule:#dcdee4; --mute:#6b7094 }
  * { box-sizing:border-box }
  body { font-family:Jost,Arial,sans-serif; color:var(--navy); margin:0;
         display:flex; flex-direction:column; min-height:calc(297mm - 32mm) }
  .head { display:flex; justify-content:space-between; align-items:flex-start }
  .head img { height:32px; width:auto }
  .meta { text-align:right; font-size:10px; line-height:1.8; color:var(--mute) }
  .meta b { color:var(--navy); font-weight:500; letter-spacing:.04em }
  h1 { font-family:'EB Garamond',Georgia,serif; font-weight:400; font-size:31px;
       margin:44px 0 0; color:var(--midnight) }
  .rule { height:1px; background:var(--gold); margin-top:18px }
  .basis { display:flex; gap:40px; margin-top:30px }
  .k { font-size:8px; letter-spacing:.16em; text-transform:uppercase; color:var(--mute); font-weight:500 }
  .v { font-family:'EB Garamond',serif; font-size:16px; color:var(--midnight); margin-top:5px }
  table { width:100%; border-collapse:collapse; margin-top:38px }
  th { font-size:8px; letter-spacing:.16em; text-transform:uppercase; color:var(--mute);
       font-weight:500; text-align:right; padding-bottom:11px; border-bottom:1px solid var(--navy) }
  th:first-child { text-align:left }
  td { padding:16px 0; border-bottom:1px solid var(--rule); text-align:right;
       vertical-align:top }
  td:first-child { text-align:left; padding-right:16px }
  .desc { font-family:'EB Garamond',serif; font-size:16px; color:var(--midnight) }
  .descsub { font-size:9.5px; color:var(--mute); margin-top:3px }
  .num { font-family:'EB Garamond',serif; font-size:16px; color:var(--midnight) }
  /* The manual sentence is 60 characters in a numeric column. Balanced wrapping
     keeps it as even lines rather than one long line and one orphan word. */
  .prompt { font-size:9.5px; line-height:1.65; color:var(--mute); text-align:right;
            text-wrap:balance }
  .estimate { margin-top:32px; display:flex; align-items:flex-end; justify-content:space-between; gap:40px }
  .estimate .title { font-family:'EB Garamond',serif; font-size:18px; color:var(--midnight) }
  .figs { display:flex; gap:56px; text-align:right }
  .big { font-family:'EB Garamond',serif; font-size:26px; color:var(--midnight); margin-top:5px; line-height:1 }
  .spacer { flex:1; min-height:28px }
  footer { font-size:7.5px; line-height:1.75; color:var(--mute); padding-top:18px;
           border-top:1px solid var(--rule); display:flex; justify-content:space-between; gap:30px }
  footer div:last-child { text-align:right; white-space:nowrap }
</style></head><body>
  <div class="head">
    <img src="${LOGO_SRC}" alt="Suttons &amp; Robertsons">
    <div class="meta"><b>${esc(quote.reference)}</b><br>${esc(quote.date)}</div>
  </div>

  <h1>Gold calculator</h1>
  <div class="rule"></div>

  <div class="basis">
    <div><div class="k">What would you like to do?</div>
         <div class="v">${esc(quote.enquiry)}</div></div>
  </div>

  <table>
    <thead><tr>
      <th style="width:42%">Item</th><th style="width:16%">Weight (grams)</th>
      <th style="width:12%">Quantity</th><th style="width:30%">Total</th>
    </tr></thead>
    <tbody>${quote.items.map(itemRow).join("")}</tbody>
  </table>

  <div class="estimate">
    <div class="title">Price Estimate</div>
    <div class="figs">
      <div><div class="k">Purchase Amount</div><div class="big">${esc(money(quote.purchaseTotal))}</div></div>
      <div><div class="k">Loan Amount</div><div class="big">${
        quote.aboveMax ? "Enquire" : esc(money(quote.loanTotal))
      }</div></div>
    </div>
  </div>

  <div class="spacer"></div>

  <footer>
    <div>${esc(LEGAL)}</div>
    <div>www.suttonsandrobertsons.com<br>${esc(PHONE)}</div>
  </footer>
</body></html>`;
}

// Waits for the iframe's own webfonts and logo before printing. Without this
// the first print can render in a fallback face, and the logo can be missing.
function printWhenReady(frame) {
  const win = frame.contentWindow;
  const ready = win.document.fonts?.ready ?? Promise.resolve();
  const images = Array.from(win.document.images).map((img) => (
    img.complete ? Promise.resolve() : new Promise((done) => {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    })
  ));

  Promise.all([ready, ...images]).then(() => {
    win.focus();
    win.print();
    // Chrome resolves print() synchronously; the frame must outlive the dialog
    // in Safari, so remove it on the next tick rather than immediately.
    setTimeout(() => frame.remove(), 1000);
  });
}

export function printQuoteSheet(root) {
  const quote = readQuote(root);
  if (!quote.items.length) return false;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;left:-9999px";
  document.body.appendChild(frame);

  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(sheet(quote));
  doc.close();

  printWhenReady(frame);
  return true;
}

export function initQuoteSheet() {
  if (typeof document === "undefined") return;

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.(TRIGGER);
    if (!trigger) return;
    event.preventDefault();

    const root = trigger.closest("form");
    if (!root) {
      // Placing the trigger outside the form is the likely authoring mistake,
      // and it would otherwise do nothing at all with no clue why.
      console.warn("[Suttons] Print my Quote trigger is not inside a form.", trigger);
      return;
    }
    printQuoteSheet(root);
  });
}

export const quoteSheetTestHooks = {
  readQuote, readItems, itemSlots, sheet, itemRow, money,
  MANUAL_PROMPT, LEGAL, PHONE,
};
