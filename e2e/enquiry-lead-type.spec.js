import { test, expect } from "@playwright/test";
import { installSubmitCapture, fillAndSubmit, LEAD_FORMS } from "./helpers/forms.js";

// New_Lead_Type is derived at submit time from enquiry_type plus the two
// sell-only follow-ups (submit-values/business-rules.js).
//
// The combination matrix is driven through `courier` because it is the shortest
// flow (2 steps, no uploads). get-a-quote deliberately runs only one case — its
// step 4 requires two real image uploads to advance, and satisfying that would
// mean POSTing files to the upload worker on every test run. The derived logic
// is shared code, so covering every branch on one form plus a spot-check on the
// others is the honest trade; the unit suite covers the branches in isolation.

const COMBINATIONS = [
  {
    name: "loan enquiry sends Loan Customer and asks no follow-ups",
    answers: { enquiry_type: "Loan" },
    expected: "Loan Customer",
  },
  {
    name: "sell + would consider both sends all three types",
    answers: { enquiry_type: "Sell My Items", enquiry_consider_loan: "Yes", enquiry_consider_consignment: "Yes" },
    expected: "SHP Customer, Loan Customer, Consignment Customer",
  },
  {
    name: "sell + loan only adds Loan Customer",
    answers: { enquiry_type: "Sell My Items", enquiry_consider_loan: "Yes", enquiry_consider_consignment: "No" },
    expected: "SHP Customer, Loan Customer",
  },
  {
    name: "sell + consignment only adds Consignment Customer",
    answers: { enquiry_type: "Sell My Items", enquiry_consider_loan: "No", enquiry_consider_consignment: "Yes" },
    expected: "SHP Customer, Consignment Customer",
  },
  {
    // The case that would submit an EMPTY field without the SHP base value.
    name: "sell + neither still sends SHP Customer, never an empty field",
    answers: { enquiry_type: "Sell My Items", enquiry_consider_loan: "No", enquiry_consider_consignment: "No" },
    expected: "SHP Customer",
  },
];

test.describe("New_Lead_Type derivation (live, nothing submitted)", () => {
  for (const combo of COMBINATIONS) {
    test(combo.name, async ({ page }) => {
      const capture = await installSubmitCapture(page);
      await page.goto("/courier-service");
      const run = await fillAndSubmit(page, "courier", { ...combo.answers, courier_pack_size: "Small" }, { manualAddress: true });

      expect(run.blocking, "no required field should block submit").toEqual([]);
      expect(capture.count(), "form should have submitted once").toBe(1);

      const fields = capture.fields();
      expect(capture.one(fields, "New_Lead_Type")).toBe(combo.expected);
      expect(capture.one(fields, "enquiry_type")).toBe(combo.answers.enquiry_type);
    });
  }

  // The derived input is created AFTER the single-submit dedup pass runs, so it
  // must never be renamed with the _disabled_ prefix, and no second value may
  // ride along under the same name.
  test("submits exactly one New_Lead_Type and leaks no _disabled_ copy", async ({ page }) => {
    const capture = await installSubmitCapture(page);
    await page.goto("/courier-service");
    await fillAndSubmit(page, "courier", {
      enquiry_type: "Sell My Items", enquiry_consider_loan: "Yes",
      enquiry_consider_consignment: "Yes", courier_pack_size: "Small",
    }, { manualAddress: true });

    const fields = capture.fields();
    expect(fields.New_Lead_Type).toHaveLength(1);
    expect(Object.keys(fields).filter((k) => /_disabled_New_Lead_Type/.test(k))).toEqual([]);
  });

  // Answers left checked from before the visitor switched to "Loan" are
  // condition-hidden, so formValues.get skips them — a loan lead must never
  // inherit them.
  test("a loan enquiry ignores follow-up answers given before switching", async ({ page }) => {
    const capture = await installSubmitCapture(page);
    await page.goto("/courier-service");

    await page.evaluate(async () => {
      const form = document.querySelector('[data-form="courier"]');
      const pick = (n, v) => {
        const r = [...form.querySelectorAll(`[name="${n}"]`)].find((x) => x.value === v);
        r.checked = true;
        ["input", "change", "click"].forEach((t) => r.dispatchEvent(new Event(t, { bubbles: true })));
      };
      pick("enquiry_type", "Sell My Items");
      await new Promise((r) => setTimeout(r, 600));
      pick("enquiry_consider_loan", "Yes");
      pick("enquiry_consider_consignment", "Yes");
      await new Promise((r) => setTimeout(r, 400));
      pick("enquiry_type", "Loan");
      await new Promise((r) => setTimeout(r, 600));
    });

    // Still physically checked, but hidden — that's the trap this guards.
    const stale = await page.evaluate(() => [...document.querySelectorAll('[name="enquiry_consider_loan"]')]
      .filter((e) => e.checked).map((e) => e.value));
    expect(stale).toEqual(["Yes"]);

    await fillAndSubmit(page, "courier", { enquiry_type: "Loan", courier_pack_size: "Small" }, { manualAddress: true });
    expect(capture.one(capture.fields(), "New_Lead_Type")).toBe("Loan Customer");
  });

  test("appointment derives the same value", async ({ page }) => {
    const capture = await installSubmitCapture(page);
    await page.goto("/find-us/make-an-appointment");
    await fillAndSubmit(page, "appointment", {
      enquiry_type: "Sell My Items", enquiry_consider_loan: "No", enquiry_consider_consignment: "No",
    });
    expect(capture.one(capture.fields(), "New_Lead_Type")).toBe("SHP Customer");
  });

  test("gold calculator derives the same value", async ({ page }) => {
    const capture = await installSubmitCapture(page);
    await page.goto("/dev/forms/gold-calculator");

    await page.evaluate(async () => {
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
      pick("gold_item_type_1", "jewellery") || pick("item_type", "jewellery");
      await new Promise((r) => setTimeout(r, 500));
      setVal(form.querySelector('[name="gold_metal_type_1"]'), "18");
      setVal(form.querySelector('[name="gold_weight_grams_1"]'), "15");
      const qty = form.querySelector('[name="gold_quantity_1"]');
      if (qty) setVal(qty, "1");
      await new Promise((r) => setTimeout(r, 1600));
    });

    // No enquiry_consider_consignment here: it was deleted from the gold
    // calculator on 9 Sep 2026 (869eu8kr1). deriveNewLeadType reads it through
    // formValues.get, so an absent field reads as not-yes and "Consignment
    // Customer" drops out with no JS change — which is what this asserts.
    await fillAndSubmit(page, "gold", {
      enquiry_type: "Sell My Items", enquiry_consider_loan: "Yes",
    });
    expect(capture.one(capture.fields(), "New_Lead_Type")).toBe("SHP Customer, Loan Customer");
  });

  test("get-a-quote offers the follow-ups and no stale New_Lead_Type markup", async ({ page }) => {
    await page.goto("/get-a-quote");
    // Uploads gate step 4, so this asserts structure rather than a full submit.
    const state = await page.evaluate(() => {
      const form = document.querySelector('[data-form="get-a-quote"]');
      return {
        hiddenLeadTypeInputs: form.querySelectorAll('[name="New_Lead_Type"]').length,
        followUps: ["enquiry_consider_loan", "enquiry_consider_consignment"]
          .map((n) => form.querySelectorAll(`[name="${n}"]`).length),
      };
    });
    expect(state.hiddenLeadTypeInputs).toBe(0);
    expect(state.followUps).toEqual([2, 2]);
  });
});
