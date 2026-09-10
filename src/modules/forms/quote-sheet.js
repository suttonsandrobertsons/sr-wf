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

// The calculator page's own <h1>, in its own sentence casing. Chosen over
// "Gold calculator" (a section heading further down that page) because that
// names the tool rather than the document: the customer is not holding a
// calculator, they are holding a price. Note it is sell-side wording and
// prints on a loan quote too — the line directly beneath answers "What would
// you like to do?" with "Loan against item" in that case.
const SHEET_TITLE = "Instant price for selling gold";

const LOGO_SRC =
  "https://cdn.prod.website-files.com/69f9fedf076067055e5a003f/6a0d90563499d746736461af_logo.svg";
// Only the four faces the sheet actually uses. Jost 300 was requested and
// never drawn — the site's 300 weight belongs to rich-text blocks, not UI copy.
const FONTS =
  "https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500&family=Jost:wght@400;500&display=swap";

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

// When the sheet was printed, to the second, so a figure on paper can be
// reconciled against the lead record it came from.
//
// PINNED TO EUROPE/LONDON, deliberately. The sheet renders on the customer's
// own device, so an unpinned toLocaleString prints THEIR clock: a customer in
// Dubai would read 15:40:12 for a lead Zoho logged at 12:40:12, which is worse
// than no timestamp because it looks precise while disagreeing. The zone
// abbreviation is printed with it — a bare time is only unambiguous to a reader
// who already assumes UK time, and the point of the timestamp is settling
// disputes with people who do not share that assumption.
const LONDON = "Europe/London";

function today(now = new Date()) {
  return now.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: LONDON,
  });
}

function printedAt(now = new Date()) {
  return now.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: LONDON, timeZoneName: "short",
  });
}

// The slots the form actually carries, in order. Read from the DOM rather than
// against a MAX_ITEMS of our own: the cap lives in the Designer markup as
// data-form-gold-max-items, so a second copy of it here would silently drop a
// row the day the client raises it.
//
// The live cap is FIVE. This function is uncapped so the sheet cannot be the
// thing that breaks when the cap moves — not a claim that six is allowed.
// Raising it is more than a Designer edit: gold.js writes slot fields up to
// max(MAX_ITEMS, the attribute), but the Zaps map five slots by name, so a
// sixth item's fields would reach Zapier and land nowhere in Zoho until the
// client extends the mapping. Page fit is also only proven to six rows.
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
    time: printedAt(),
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
<html><head><meta charset="utf-8"><title>${esc(SHEET_TITLE)} — ${esc(quote.reference)}</title>
<link rel="stylesheet" href="${FONTS}">
<style>
  /* BRAND. Measured from the live site with Chromium computed styles on
     10 Sep 2026, not eyeballed and not taken from the token names alone —
     several tokens are overridden in practice. What the site actually renders:

       h1              EB Garamond 400, line-height 1, midnight #111420
       h3              EB Garamond 400, line-height 1, navy #262c46
       h2 (small)      EB Garamond 500, line-height 1, midnight
       "Item 1"        EB Garamond 400, 1.625rem, navy
       body + figures  Jost 400, 1rem, line-height 1.2, NAVY #262c46
       micro-label     Jost 500, 0.75rem, letter-spacing 0.07em, uppercase
       row border      #edeffa, the site's own --_theme---table--border

     Two corrections to earlier drafts. Body text is NAVY, not midnight: the
     --_theme---section--text token reads #111420 but every rendered paragraph,
     label and figure computes to #262c46, and midnight is reserved for
     headings. And body weight is 400 — the 300 in --_rich-text---body--fw
     applies only inside rich-text blocks, not to UI copy.

     THE SITE HAS NO TABLES. Nothing on any page renders a <table>, so the row
     rules, the head rule and the column rhythm have no brand precedent to copy
     and are built from brand atoms: navy for the structural head rule,
     --_theme---table--border for the row rules.

     DELIBERATE DEVIATIONS, all of them scale, none of them colour, weight or
     face. The site is fluid type on a 1440px viewport; this is a fixed 210mm
     page, so sizes step down the brand's own scale rather than sitting at the
     web value: h1 uses --_type---title--xs (1.625rem) where the page uses
     3.375rem, and the item name uses 1.125rem where "Item 1" uses 1.625rem —
     at 1.625rem the item rows plus the legal footer do not fit on one A4 page,
     which is the whole point of the sheet. The legal paragraph is 8px because
     the footer's own 1rem would run to four lines.

     PAGE FIT. The live calculator's cap is FIVE — data-form-gold-max-items="5"
     in the Designer markup, MAX_ITEMS in gold.js, and five slots in the Zoho
     field mappings. Measured in Chromium: five rows and six rows each render
     as one page, seven does not. So there is a row of headroom above the
     current cap, and none above six. */
  @page { size: A4; margin: 16mm 15mm }
  @media screen {
    html { background:#f4f4f6; padding:24px 0 }
    body { width:210mm; min-height:297mm; margin:0 auto; padding:16mm 15mm;
           background:#fff; box-shadow:0 1px 24px rgba(17,20,32,.14) }
  }
  :root {
    --navy:#262c46; --midnight:#111420; --gold:#ae9a64;
    --rule:#edeffa; --mute:#6b7094;
    --title:'EB Garamond',Georgia,sans-serif; --body:Jost,Arial,sans-serif;
  }
  * { box-sizing:border-box }
  body { font-family:var(--body); font-weight:400; font-size:16px; line-height:1.2;
         color:var(--navy); margin:0;
         display:flex; flex-direction:column; min-height:calc(297mm - 32mm) }
  .head { display:flex; justify-content:space-between; align-items:flex-start }
  .head img { height:32px; width:auto }
  .meta { text-align:right; font-size:11px; line-height:1.6; color:var(--navy) }
  .meta b { font-weight:500; letter-spacing:.07em }
  h1 { font-family:var(--title); font-weight:400; font-size:26px; line-height:1;
       margin:44px 0 0; color:var(--midnight) }
  .rule { height:1px; background:var(--gold); margin-top:18px }
  .basis { margin-top:30px }
  /* The site's uppercase micro-label, exactly: Jost 500, 12px, 0.07em.
     Navy by default and gold only on the two Price Estimate figures. Gold is
     the brand's accent — button and link colour — so it earns nothing when
     every label carries it; spent once it points at the numbers the sheet
     exists for. The gold hairline under the title is the other instance. */
  .k { font-family:var(--body); font-weight:500; font-size:12px; line-height:1;
       letter-spacing:.07em; text-transform:uppercase; color:var(--navy) }
  .figs .k { color:var(--gold) }
  .v { font-size:16px; line-height:1.2; color:var(--navy); margin-top:7px }
  table { width:100%; border-collapse:collapse; margin-top:36px }
  /* Every column right-aligned except the description, each numeric column with
     its own left gutter: without it a right-aligned Quantity sits against the
     next column and the two read as one figure (client feedback, 10 Sep 2026). */
  th, td { text-align:right; padding-left:28px }
  th:first-child, td:first-child { text-align:left; padding-left:0; padding-right:28px }
  /* "Weight (grams)" is the only header that wraps to two lines. A table cell
     defaults to vertical-align:middle, so the one-line headers centred against
     it and sat lower than its first line; top-aligning every header starts all
     of them on the same line. */
  th { font-family:var(--body); font-weight:500; font-size:12px; line-height:1.25;
       letter-spacing:.07em; text-transform:uppercase; color:var(--navy);
       vertical-align:top; padding-bottom:12px; border-bottom:1px solid var(--navy) }
  td { padding-top:15px; padding-bottom:15px; border-bottom:1px solid var(--rule);
       vertical-align:top }
  .desc { font-family:var(--title); font-weight:400; font-size:18px; line-height:1.05;
          color:var(--navy) }
  .descsub { font-size:11px; line-height:1.2; color:var(--mute); margin-top:4px }
  .num { font-size:16px; line-height:1.2; color:var(--navy) }
  .prompt { font-size:11px; line-height:1.4; color:var(--mute); text-align:right;
            text-wrap:balance }
  .estimate { margin-top:34px; display:flex; align-items:flex-end;
              justify-content:space-between; gap:40px }
  .estimate .title { font-family:var(--title); font-weight:500; font-size:20px;
                     line-height:1; color:var(--midnight) }
  .figs { display:flex; gap:56px; text-align:right }
  .big { font-size:20px; line-height:1; color:var(--navy); margin-top:7px }
  .spacer { flex:1; min-height:28px }
  footer { font-size:8px; line-height:1.7; color:var(--mute); padding-top:18px;
           border-top:1px solid var(--rule); display:flex;
           justify-content:space-between; gap:30px }
  footer div:last-child { text-align:right; white-space:nowrap }
</style></head><body>
  <div class="head">
    <img src="${LOGO_SRC}" alt="Suttons &amp; Robertsons">
    <div class="meta"><b>${esc(quote.reference)}</b><br>${esc(quote.date)}<br>${esc(quote.time)}</div>
  </div>

  <h1>${esc(SHEET_TITLE)}</h1>
  <div class="rule"></div>

  <div class="basis">
    <div><div class="k">What would you like to do?</div>
         <div class="v">${esc(quote.enquiry)}</div></div>
  </div>

  <table>
    <thead><tr>
      <th style="width:38%">Item</th><th style="width:18%">Weight (grams)</th>
      <th style="width:14%">Quantity</th><th style="width:30%">Total</th>
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
  MANUAL_PROMPT, LEGAL, PHONE, SHEET_TITLE, today, printedAt,
};
