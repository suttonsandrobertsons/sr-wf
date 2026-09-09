import { test, expect } from "@playwright/test";
import { pickRadio, fieldState, LEAD_FORMS } from "./helpers/forms.js";

// No submissions here — these tests assert markup and conditions-engine state only.

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
      // one would be a real bug: courier_option is not in singleValueFieldNames,
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

test.describe("box_and_papers — the other combination field still dedups", () => {
  // box_and_papers is four same-named hidden inputs, one per Yes/No combination,
  // collapsed to a single submitter by singleValueFieldNames. This is the pattern
  // New_Lead_Type used to use, so it's worth keeping honest cover on it.
  //
  // Note the dedup renames at RENDER time, not just at submit: until the two
  // questions are answered all four are condition-hidden, so none is "active"
  // and every one carries the _disabled_ prefix. Identify them by the
  // data-form-submit-original-name the engine stamps on, not by their live name.
  test("all four combinations are registered and only one can ever win", async ({ page }) => {
    await page.goto("/get-a-quote");

    const group = await page.evaluate(() => {
      const form = document.querySelector('[data-form="get-a-quote"]');
      const members = [...form.querySelectorAll('[data-form-submit-original-name="box_and_papers"]')];
      return {
        registered: members.length,
        liveNames: members.filter((m) => m.getAttribute("name") === "box_and_papers").length,
        values: members.map((m) => m.value),
      };
    });

    expect(group.registered, "four combinations should be registered with the dedup").toBe(4);
    expect(group.values).toEqual([
      "Original Box and Papers", "Original Box Only", "Original Papers Only", "None",
    ]);
    expect(group.liveNames, "no combination may submit before the questions are answered").toBe(0);
  });

  test("answering both Yes leaves exactly one submitting value", async ({ page }) => {
    await page.goto("/get-a-quote");

    const result = await page.evaluate(async () => {
      const form = document.querySelector('[data-form="get-a-quote"]');
      const pick = (n, v) => {
        const r = [...form.querySelectorAll(`[name="${n}"]`)].find((x) => x.value === v);
        if (!r) return false;
        r.checked = true;
        ["input", "change", "click"].forEach((t) => r.dispatchEvent(new Event(t, { bubbles: true })));
        return true;
      };
      // The two questions only appear for these asset types.
      pick("asset_type", "Watches");
      await new Promise((r) => setTimeout(r, 700));
      const set = pick("original_box", "yes") && pick("original_paperwork", "yes");
      await new Promise((r) => setTimeout(r, 800));
      const live = [...form.querySelectorAll('[name="box_and_papers"]')];
      return { set, liveCount: live.length, liveValue: live[0]?.value ?? null };
    });

    expect(result.set, "the box/papers questions should be reachable").toBe(true);
    expect(result.liveCount, "exactly one combination may submit").toBe(1);
    expect(result.liveValue).toBe("Original Box and Papers");
  });
});
