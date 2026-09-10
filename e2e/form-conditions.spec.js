import { test, expect } from "@playwright/test";
import { pickRadio, fieldState, LEAD_FORMS, installSubmitCapture, fillAndSubmit } from "./helpers/forms.js";

// No REAL submissions here. installSubmitCapture intercepts Webflow's form
// endpoint and answers 200 itself, so a payload can be asserted without a lead
// ever reaching Webflow, Zapier or Zoho.

const ENQUIRY_FORMS = LEAD_FORMS;

// enquiry_consider_consignment was deleted from the gold calculator only
// (869eu8kr1, 9 Sep 2026) — three Designer instances: /gold-loans/calculator,
// /sell-gold/calculator and /dev/forms/gold-calculator. Every other lead form
// still asks it, and the shared form_radio-group component is untouched, so
// the retention below is as much the point of these tests as the removal.
const asksConsignment = (key) => key !== "gold";
const followUpsFor = (key) =>
  asksConsignment(key)
    ? ["enquiry_consider_loan", "enquiry_consider_consignment"]
    : ["enquiry_consider_loan"];

test.describe("enquiry question — shape on every lead form", () => {
  for (const { key, path } of ENQUIRY_FORMS) {
    test(`${key} on ${path} offers exactly Loan and Sell My Items`, async ({ page }) => {
      await page.goto(path);
      const enquiry = await fieldState(page, key, "enquiry_type");

      expect(enquiry.present).toBe(true);
      expect(enquiry.values).toEqual(["Loan", "Sell My Items"]);
      expect(enquiry.required).toBe(true);
      // Consignment / Unknown were removed from the CMS — they must not survive
      // anywhere, or the old dead conditionals could come back to life.
      expect(enquiry.values).not.toContain("Consignment");
      expect(enquiry.values).not.toContain("Unknown");
    });

    test(`${key} on ${path} has no leftover New_Lead_Type markup`, async ({ page }) => {
      await page.goto(path);
      const leadType = await fieldState(page, key, "New_Lead_Type");
      expect(leadType.present, "New_Lead_Type is derived at submit, never authored").toBe(false);
    });

    test(`${key} on ${path} ${asksConsignment(key) ? "asks" : "does not ask"} about consignment`, async ({ page }) => {
      await page.goto(path);
      const consignment = await fieldState(page, key, "enquiry_consider_consignment");

      // Deleted, not hidden: the field carries data-form-field-required, and a
      // required control that is present but invisible can stop step 1 from
      // validating at all. Absent also makes deriveNewLeadType drop
      // "Consignment Customer" on its own, with no JS change.
      expect(consignment.present).toBe(asksConsignment(key));
    });

    test(`${key} on ${path} gates the follow-ups on a sell enquiry`, async ({ page }) => {
      await page.goto(path);

      expect(await pickRadio(page, key, "enquiry_type", "Loan")).toBe(true);
      await page.waitForTimeout(700);
      for (const name of followUpsFor(key)) {
        const hidden = await fieldState(page, key, name);
        expect(hidden.present, `${name} should exist`).toBe(true);
        expect(hidden.visible, `${name} must be hidden for a loan enquiry`).toBe(false);
        expect(hidden.conditionHidden).toBe(true);
      }

      expect(await pickRadio(page, key, "enquiry_type", "Sell My Items")).toBe(true);
      await page.waitForTimeout(700);
      for (const name of followUpsFor(key)) {
        const shown = await fieldState(page, key, name);
        expect(shown.visible, `${name} must show for a sell enquiry`).toBe(true);
        expect(shown.conditionHidden).toBe(false);
        expect(shown.values).toEqual(["Yes", "No"]);
        expect(shown.required).toBe(true);
      }
    });
  }
});

test.describe("courier — transact question removed, pack size retained", () => {
  for (const path of ["/courier-service", "/sell-gold/sell-gold-by-post"]) {
    test(`${path} sends a fixed Special Delivery Pack`, async ({ page }) => {
      await page.goto(path);
      const option = await fieldState(page, "courier", "courier_option");

      // Exactly one control, carrying Zoho's own Fullfillment value. More than
      // one would be a real bug: courier_option is not in chooseOneFieldNames,
      // so there is no dedup safety net to pick a winner.
      expect(option.present).toBe(true);
      expect(option.count).toBe(1);
      expect(option.values).toEqual(["Special Delivery Pack"]);
      expect(option.visible, "the question is removed from view").toBe(false);

      // The old three choices must be gone.
      expect(option.values).not.toContain("Special Delivery Label");
      expect(option.values).not.toContain("Discussing My Options");
    });

    test(`${path} still asks the pack size, unconditionally`, async ({ page }) => {
      await page.goto(path);
      const size = await fieldState(page, "courier", "courier_pack_size");
      expect(size.present).toBe(true);
      expect(size.visible, "pack size must show now courier_option is fixed").toBe(true);
      expect(size.required).toBe(true);
      expect(size.values).toEqual(["Small", "Medium", "Large", "Unsure"]);
    });
  }
});

test.describe("gold calculator — enquiry still drives the quote basis", () => {
  test("loan shows the loan total and hides the estimate row; sell flips both", async ({ page }) => {
    await page.goto("/dev/forms/gold-calculator");

    const priceOneItem = async (enquiry) => page.evaluate(async (enquiry) => {
      const form = document.querySelector('[data-form="gold"]');
      const setVal = (el, v) => {
        const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
        ["input", "change"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
      };
      const pick = (n, v) => {
        const r = [...form.querySelectorAll(`[name="${n}"]`)].find((x) => x.value === v);
        if (!r) return false;
        r.checked = true;
        ["input", "change", "click"].forEach((t) => r.dispatchEvent(new Event(t, { bubbles: true })));
        return true;
      };
      pick("enquiry_type", enquiry);
      await new Promise((r) => setTimeout(r, 400));
      pick("gold_item_type_1", "jewellery") || pick("item_type", "jewellery");
      await new Promise((r) => setTimeout(r, 500));
      const carat = form.querySelector('[name="gold_metal_type_1"]');
      if (carat) setVal(carat, "18");
      const weight = form.querySelector('[name="gold_weight_grams_1"]');
      if (weight) setVal(weight, "15");
      const qty = form.querySelector('[name="gold_quantity_1"]');
      if (qty) setVal(qty, "1");
      await new Promise((r) => setTimeout(r, 1800));
      const row = form.querySelector(".form-gold_estimate-row");
      const read = (n) => form.querySelector(`[name="${n}"]`)?.value ?? null;
      return {
        total: read("gold_total"), loan: read("gold_loan_total"), purchase: read("gold_purchase_total"),
        rowVisible: row ? row.offsetParent !== null : null,
      };
    }, enquiry);

    const loan = await priceOneItem("Loan");
    expect(Number(loan.loan)).toBeGreaterThan(0);
    expect(loan.total).toBe(loan.loan);
    expect(loan.rowVisible, "estimate row is sell-only").toBe(false);

    const sell = await priceOneItem("Sell My Items");
    expect(sell.total).toBe(sell.purchase);
    expect(sell.rowVisible).toBe(true);
    expect(Number(sell.purchase)).toBeGreaterThan(Number(sell.loan));
  });
});

test.describe("box_and_papers — computed in code, not authored", () => {
  // The four same-named Designer inputs were deleted on 10 Sep 2026, after the
  // bundle carrying computeBoxAndPapers went live. This replaced the
  // deployment-order guard that watched for exactly that moment.
  //
  // WHY THE PAYLOAD IS NOT ASSERTED HERE. box_and_papers exists only on
  // get-a-quote, and that form cannot be submitted in a smoke test: step 3
  // carries two REQUIRED uploads, so reaching submit means POSTing real files
  // to the Cloudflare Worker on every run. The payload is covered instead by
  // __tests__/submit-values-ownership.test.js, which runs the rule through the
  // faithful port of Webflow's serialiser, including the answered case and the
  // never-asked case.
  //
  // What only a live page can prove is below: that the authored inputs are
  // really gone, and that the radios the rule reads are really still there.

  test("the authored inputs are gone and the rule's sources remain", async ({ page }) => {
    await page.goto("/get-a-quote");
    const counts = await page.evaluate(() => {
      const form = document.querySelector('[data-form="get-a-quote"]');
      const n = (name) => form.querySelectorAll(`[name="${name}"]`).length;
      return {
        authored: n("box_and_papers"),
        renamed: n("_disabled_box_and_papers"),
        original_box: n("original_box"),
        original_paperwork: n("original_paperwork"),
      };
    });

    // Re-adding any would beat the computed value: duplicates collapse to the
    // last in DOM order and the owned hidden is not guaranteed to be last.
    expect(counts.authored, "no authored box_and_papers input may exist").toBe(0);
    expect(counts.renamed, "nor a renamed leftover from the old dedup").toBe(0);

    // Delete these by accident and the rule silently returns null forever.
    expect(counts.original_box).toBeGreaterThan(0);
    expect(counts.original_paperwork).toBeGreaterThan(0);
  });

  test("asks the box and papers questions only for the asset types that have them", async ({ page }) => {
    // The rule's isAnswered guard depends on these being condition-hidden for
    // every other asset type. If they ever showed for Gold, a gold lead would
    // start carrying box_and_papers.
    await page.goto("/get-a-quote");

    // conditionHidden, not visible. These radios live on step 2 while
    // asset_type is on step 1, so offsetParent is null for both answers and a
    // visibility assertion passes for the wrong reason. conditionHidden is the
    // conditions engine's own verdict and is independent of which step is open.
    //
    // Polled because the engine runs off a change event and takes a beat.
    const boxHidden = () =>
      fieldState(page, "get-a-quote", "original_box").then((s) => s.conditionHidden);

    await pickRadio(page, "get-a-quote", "asset_type", "Watches");
    await expect.poll(boxHidden, { message: "Watches should ask the box question" }).toBe(false);

    await pickRadio(page, "get-a-quote", "asset_type", "Gold");
    await expect.poll(boxHidden, { message: "Gold should not ask it" }).toBe(true);
  });
});
