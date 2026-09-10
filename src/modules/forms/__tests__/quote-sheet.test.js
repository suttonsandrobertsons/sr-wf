import { beforeEach, describe, expect, it } from "vitest";

import { printQuoteSheet, quoteSheetTestHooks } from "../quote-sheet.js";
import { formatMoney } from "../numbers.js";
import { MANUAL_QUOTE_PROMPT } from "../gold.js";

const { readQuote, sheet, MANUAL_PROMPT, LEGAL, PHONE, SHEET_TITLE } = quoteSheetTestHooks;

function buildForm(fields) {
  const form = document.createElement("form");
  form.innerHTML = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${value}">`)
    .join("");
  document.body.append(form);
  return form;
}

// A priced jewellery item plus a Sovereign, at the figures the live calculator
// produces (verified against the site on 9 Sep 2026 at £104.40 spot).
const TWO_ITEMS = {
  lead_reference: "BURGE-R625-FPWN",
  enquiry_type: "Loan",
  gold_spot_price_gbp_gram: "104.4",
  gold_pricing_updated_at: "09/09/2026, 15:24:00",
  gold_item_count: "2",
  gold_purchase_total: "1636",
  gold_loan_total: "1411",
  bullion_name_1: "18ct Gold",
  gold_item_1_label: "18ct",
  gold_item_1_type: "Jewellery",
  gold_item_1_weight_grams: "15",
  gold_item_1_quantity: "1",
  gold_item_1_purchase_value: "983",
  gold_item_1_loan_value: "855",
  gold_item_1_amount: "855",
  gold_item_1_manual: "false",
  bullion_name_2: "Gold Sovereign",
  gold_item_2_label: "Gold Sovereign",
  gold_item_2_type: "Coin",
  gold_item_2_weight_grams: "7.99",
  gold_item_2_quantity: "1",
  gold_item_2_purchase_value: "653",
  gold_item_2_loan_value: "556",
  gold_item_2_amount: "556",
  gold_item_2_manual: "false",
};

describe("quote sheet", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("reads the quote from the form's own hidden fields", () => {
    const quote = readQuote(buildForm(TWO_ITEMS));

    expect(quote.reference).toBe("BURGE-R625-FPWN");
    expect(quote.enquiry).toBe("Loan against item");
    expect(quote.items).toHaveLength(2);
    expect(quote.items[0]).toMatchObject({
      label: "18ct", type: "Jewellery", amount: "855", manual: false,
    });
  });

  it("maps the enquiry value to the label the form shows", () => {
    // The radios submit Zoho's values; the sheet should read like the page did.
    expect(readQuote(buildForm({ ...TWO_ITEMS, enquiry_type: "Sell My Items" })).enquiry)
      .toBe("Sell my item");
  });

  it("formats figures as whole pounds with a thousands separator", () => {
    const html = sheet(readQuote(buildForm(TWO_ITEMS)));

    expect(html).toContain("£1,636");
    expect(html).toContain("£1,411");
    expect(html).toContain("£855");
  });

  it("takes the manual sentence from gold.js, not a copy of it", () => {
    // The screen and the sheet must word an unpriced row identically, so there
    // is one literal and both read it.
    expect(MANUAL_PROMPT).toBe(MANUAL_QUOTE_PROMPT);
  });

  it("reads however many slots the form carries, not a hardcoded five", () => {
    // The cap is data-form-gold-max-items in the Designer. A MAX_ITEMS of our
    // own would drop item 6 silently the day the client raises it.
    const quote = readQuote(buildForm({
      ...TWO_ITEMS,
      bullion_name_6: "x", gold_item_6_label: "1 Oz Gold Britannia",
      gold_item_6_type: "Coin", gold_item_6_amount: "2400", gold_item_6_manual: "false",
    }));

    expect(quote.items).toHaveLength(3);
    expect(quote.items[2].label).toBe("1 Oz Gold Britannia");
  });

  it("ignores unused item slots", () => {
    const quote = readQuote(buildForm({
      ...TWO_ITEMS,
      bullion_name_3: "", gold_item_3_purchase_value: "",
    }));

    expect(quote.items).toHaveLength(2);
  });

  it("gives an unpriced row the page's own prompt, never a figure", () => {
    // An unlisted coin or "I'm not sure" produces a manual row with no values.
    // The page swaps that row's "TOTAL:" for this sentence; £0 next to a real
    // item would read as an offer of nothing.
    const html = sheet(readQuote(buildForm({
      ...TWO_ITEMS,
      gold_item_2_manual: "true",
      gold_item_2_amount: "",
      gold_item_2_purchase_value: "",
      gold_item_2_loan_value: "",
    })));

    // The sentence in full, exactly as the front end writes it — not a
    // shortened version of it, and not wording of the sheet's own.
    expect(MANUAL_PROMPT).toBe("Manual quote required — enter details and we'll get back to you");
    expect(html).toContain("Manual quote required — enter details and we'll get back to you");
    expect(html).not.toContain("£0");
  });

  it("escapes item descriptions", () => {
    const html = sheet(readQuote(buildForm({
      ...TWO_ITEMS, gold_item_1_label: '18ct <script>alert(1)</script>',
    })));

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("titles the sheet with the calculator page's own h1", () => {
    // "Gold calculator" named the tool; this names the document. It is also
    // the default filename when the customer chooses Save as PDF.
    const html = sheet(readQuote(buildForm(TWO_ITEMS)));

    expect(SHEET_TITLE).toBe("Instant price for selling gold");
    expect(html).toContain("<h1>Instant price for selling gold</h1>");
    expect(html).toContain("<title>Instant price for selling gold — BURGE-R625-FPWN</title>");
    expect(html).not.toContain("Gold calculator");
  });

  it("spends gold on the two Price Estimate figures, not every label", () => {
    // Gold is the brand's accent colour. Navy is the default for micro-labels
    // and column headers so the accent still means something.
    const html = sheet(readQuote(buildForm(TWO_ITEMS)));

    expect(html).toContain("text-transform:uppercase; color:var(--navy)");
    expect(html).toContain(".figs .k { color:var(--gold) }");
  });

  it("uses the brand values measured from the live site", () => {
    // Measured with Chromium computed styles on 10 Sep 2026, because the token
    // names alone are misleading: --_theme---section--text reads #111420 but
    // every rendered paragraph and figure computes to navy #262c46, and the
    // 300 weight in --_rich-text---body--fw applies only to rich-text blocks.
    // These assertions exist so a later tidy-up cannot quietly drift off brand.
    const html = sheet(readQuote(buildForm(TWO_ITEMS)));

    expect(html).toContain("--navy:#262c46");
    expect(html).toContain("--midnight:#111420");
    expect(html).toContain("--gold:#ae9a64");
    // The site's own --_theme---table--border, not the #dcdee4 I first picked.
    expect(html).toContain("--rule:#edeffa");
    // Body: Jost 400 navy, not weight 300 and not midnight.
    expect(html).toContain("font-weight:400");
    expect(html).not.toContain("font-weight:300");
    // The micro-label treatment: Jost 500, 12px, 0.07em, uppercase.
    expect(html).toContain("letter-spacing:.07em");
    expect(html).not.toContain("letter-spacing:.16em");
    expect(html).toContain("'EB Garamond',Georgia,sans-serif");
  });

  it("carries the site's own footer verbatim, and the reference", () => {
    const html = sheet(readQuote(buildForm(TWO_ITEMS)));

    // Quoted from the live footer, not paraphrased — a printed document in
    // their name must not restate their regulatory wording in our words.
    expect(LEGAL).toContain("Firm reference number 731198");
    expect(LEGAL).toContain("company number 433606");
    expect(LEGAL).toContain("VAT number: GB23828037");
    expect(PHONE).toBe("0800 182 2330");
    expect(html).toContain("BURGE-R625-FPWN");
  });

  it("prints no wording that is not quoted from the site", () => {
    // Guards the rule directly. Earlier drafts invented "Requires inspection",
    // "Gold price", "Taken at" and a phone number the site does not use.
    const html = sheet(readQuote(buildForm(TWO_ITEMS)));

    ["Requires inspection", "Gold price", "Taken at", "0800 038 9839", "/g",
      "indicative", "Indicative", "valid for", "subject to"].forEach((invented) => {
      expect(html).not.toContain(invented);
    });

    // The page's own qualifier, and the only one: the heading above the figures.
    expect(html).toContain("Price Estimate");
  });

  it("refuses to print when there are no items", () => {
    // The Describe Items route parses nothing, so every figure would be blank.
    // A branded sheet of empty values is worse than no sheet.
    expect(printQuoteSheet(buildForm({ lead_reference: "SR-AAAA-BBBB" }))).toBe(false);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("writes the sheet into an isolated iframe so site CSS cannot reach it", () => {
    const printed = printQuoteSheet(buildForm(TWO_ITEMS));
    const frame = document.querySelector("iframe");

    expect(printed).toBe(true);
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.contentWindow.document.title).toContain("BURGE-R625-FPWN");
  });

  it("renders money exactly as the calculator does, via its own formatter", () => {
    // The page displays three values — per-item subtotal, purchase_total and
    // loan_total — all money keys rendered by formatMoney at 0 decimals. If
    // the sheet formatted them any other way the customer would hold a
    // document that disagrees with the screen they just read.
    const html = sheet(readQuote(buildForm(TWO_ITEMS)));

    expect(html).toContain(formatMoney(1636));
    expect(html).toContain(formatMoney(1411));
    expect(html).toContain(formatMoney(855));
    expect(html).toContain(formatMoney(556));
  });

  it("uses the page's own labels and casing for everything it shows", () => {
    // Censused against the live calculator: these are the only figures the
    // page displays, and this is how it names them.
    const html = sheet(readQuote(buildForm(TWO_ITEMS)));

    expect(html).toContain("Price Estimate");
    expect(html).toContain("Purchase Amount");
    expect(html).toContain("Loan Amount");
    expect(html).toContain("Weight (grams)");
    expect(html).toContain("Quantity");
    expect(html).toContain("What would you like to do?");
    // The dropdown's option text, not the Zoho-facing "18ct Gold".
    expect(html).toContain(">18ct<");
    expect(html).not.toContain("18ct Gold");
  });

  it("prints one per-item figure, the same branch the page's TOTAL uses", () => {
    // getDisplayValue picks loan for a loan enquiry, purchase for a sale. The
    // page shows that single number per row; showing both would print a figure
    // the customer never saw.
    const html = sheet(readQuote(buildForm(TWO_ITEMS)));

    // Loan enquiry: gold_item_N_amount is the loan value.
    expect(html).toContain(formatMoney(855));
    expect(html).not.toContain(formatMoney(983));
    expect(html).not.toContain(formatMoney(653));
  });

  it("prints the hidden field values unchanged, doing no arithmetic of its own", () => {
    // The 50p MROUND model and roundWholePound have already been applied by
    // gold.js. Recomputing anything here is how a sheet starts disagreeing
    // with the CRM record for the same reference.
    const quote = readQuote(buildForm(TWO_ITEMS));

    expect(quote.items.map((i) => i.amount)).toEqual(["855", "556"]);
    expect(quote.purchaseTotal).toBe("1636");
    expect(quote.loanTotal).toBe("1411");
    // Weight prints as entered; the calculator never displays it, and
    // formatNumber would round 7.99 to 8.
    expect(quote.items[1].weight).toBe("7.99");
  });

  it("never prints the gold price, which the calculator never displays", () => {
    // The basis of every figure on the sheet, and the one number the customer
    // was not shown. Printing it hands them a value they cannot check.
    const html = sheet(readQuote(buildForm(TWO_ITEMS)));

    expect(html).not.toContain("104.40");
    expect(html).not.toContain("104.4");
    // And nothing is written to stand in for it. The sell-side bullet that
    // was here read as a validity disclaimer it is not, and said "your offer"
    // of an estimate.
    expect(html).not.toContain("Spot price");
    expect(html).not.toContain("your offer");
  });

  it("shows Enquire instead of a loan figure above the maximum", () => {
    // Over the top rate band the business makes no loan, and the calculator
    // writes "Enquire" rather than a number. The sheet has no terms block, so
    // a bare figure here would promise a loan that is not available.
    const html = sheet(readQuote(buildForm({
      ...TWO_ITEMS, gold_is_above_max: "true", gold_loan_total: "68800",
    })));

    expect(html).toContain("Enquire");
    expect(html).not.toContain("£68,800");
  });

  it("still shows the loan figure below the maximum", () => {
    const html = sheet(readQuote(buildForm({ ...TWO_ITEMS, gold_is_above_max: "false" })));
    expect(html).toContain("£1,411");
    expect(html).not.toContain("Enquire");
  });
});
