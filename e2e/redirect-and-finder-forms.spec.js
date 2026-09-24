import { test, expect } from "@playwright/test";

// The non-lead forms. None of these submits to Zoho:
//  - home-hero / loan  → data-form-mode="redirect", they hand over to get-a-quote
//    via URL params which get-a-quote consumes and strips (stripAfterHydrate).
//  - fulfilment-finder / product-finder → client-side card filtering only.
//  - footer-form → newsletter; validation only, never submitted here.
//
// A handed-over value with no matching option prefills nothing and shows no
// error, so the handoff is checked directly.

const setSelect = async (page, formKey, name, value) =>
  page.evaluate(({ formKey, name, value }) => {
    const form = document.querySelector(`[data-form="${formKey}"]`);
    const el = form.querySelector(`[name="${name}"]`);
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, value);
    ["input", "change"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
    return true;
  }, { formKey, name, value });

test.describe("home-hero → get-a-quote handoff", () => {
  test("offers only the two current enquiry options", async ({ page }) => {
    await page.goto("/");
    const options = await page.evaluate(() => {
      const sel = document.querySelector('[data-form="home-hero"] [name="enquiry_type"]');
      return [...sel.options].map((o) => o.value).filter(Boolean);
    });
    expect(options).toEqual(["Loan", "Sell My Items"]);
  });

  test("a sell enquiry carries over AND reveals the follow-ups on arrival", async ({ page }) => {
    await page.goto("/");
    await setSelect(page, "home-hero", "asset_type", "Watches");
    await setSelect(page, "home-hero", "enquiry_type", "Sell My Items");
    await page.evaluate(() => document.querySelector('[data-form="home-hero"] [data-form-action="redirect"]').click());
    await page.waitForURL("**/get-a-quote**");

    const landed = await page.evaluate(() => {
      const form = document.querySelector('[data-form="get-a-quote"]');
      const checked = (n) => [...form.querySelectorAll(`[name="${n}"]`)].filter((e) => e.checked).map((e) => e.value);
      return {
        enquiry: checked("enquiry_type"),
        asset: checked("asset_type"),
        followUpsVisible: [...form.querySelectorAll('[name="enquiry_consider_loan"]')].some((e) => e.offsetParent !== null),
      };
    });
    expect(landed.enquiry).toEqual(["Sell My Items"]);
    expect(landed.asset).toEqual(["Watches"]);
    expect(landed.followUpsVisible, "a carried-over sell enquiry must reveal the follow-ups").toBe(true);
  });

  test("a loan enquiry carries over and leaves the follow-ups hidden", async ({ page }) => {
    await page.goto("/");
    await setSelect(page, "home-hero", "asset_type", "Watches");
    await setSelect(page, "home-hero", "enquiry_type", "Loan");
    await page.evaluate(() => document.querySelector('[data-form="home-hero"] [data-form-action="redirect"]').click());
    await page.waitForURL("**/get-a-quote**");

    const landed = await page.evaluate(() => {
      const form = document.querySelector('[data-form="get-a-quote"]');
      return {
        enquiry: [...form.querySelectorAll('[name="enquiry_type"]')].filter((e) => e.checked).map((e) => e.value),
        followUpsVisible: [...form.querySelectorAll('[name="enquiry_consider_loan"]')].some((e) => e.offsetParent !== null),
      };
    });
    expect(landed.enquiry).toEqual(["Loan"]);
    expect(landed.followUpsVisible).toBe(false);
  });
});

test.describe("loan pages → get-a-quote handoff", () => {
  for (const path of ["/pawnbroking", "/pawn-shop-loan-calculator", "/valuation-process"]) {
    test(`${path} hands over pre-set to Loan`, async ({ page }) => {
      await page.goto(path);
      const hardcoded = await page.evaluate(() =>
        document.querySelector('[data-form="loan"] [name="enquiry_type"]')?.value ?? null);
      expect(hardcoded).toBe("Loan");

      await page.evaluate(() => document.querySelector('[data-form="loan"] [data-form-action="redirect"]').click());
      await page.waitForURL("**/get-a-quote**");
      const enquiry = await page.evaluate(() =>
        [...document.querySelectorAll('[data-form="get-a-quote"] [name="enquiry_type"]')]
          .filter((e) => e.checked).map((e) => e.value));
      expect(enquiry).toEqual(["Loan"]);
    });
  }
});

test.describe("fulfilment-finder card filtering", () => {
  const cards = (page) => page.evaluate(() => {
    const ff = document.querySelector('[data-form="fulfilment-finder"]');
    return [...ff.querySelectorAll(".product-card-wrap")].map((w) => ({
      name: (w.innerText || "").split("\n").filter(Boolean)[0] || "?",
      eligible: !/condition-hidden/.test(w.getAttribute("data-form-state") || ""),
    }));
  });

  test("shows every option until questions are answered (partial matching)", async ({ page }) => {
    await page.goto("/fulfilment-finder");
    const initial = await cards(page);
    expect(initial.length).toBeGreaterThan(1);
    expect(initial.every((c) => c.eligible), "unanswered rules must not eliminate anything").toBe(true);
  });

  test("narrows to in-store options for a same-day London high-value watch", async ({ page }) => {
    await page.goto("/fulfilment-finder");
    await page.evaluate(() => {
      const ff = document.querySelector('[data-form="fulfilment-finder"]');
      const pick = (n, v) => {
        const r = [...ff.querySelectorAll(`[name="${n}"]`)].find((x) => x.value === v);
        if (r) { r.checked = true; ["input", "change", "click"].forEach((t) => r.dispatchEvent(new Event(t, { bubbles: true }))); return; }
        const sel = ff.querySelector(`[name="${n}"]`);
        if (sel) {
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, v);
          ["input", "change"].forEach((t) => sel.dispatchEvent(new Event(t, { bubbles: true })));
        }
      };
      pick("asset_type", "Watches");
      pick("requested_amount", "amount_40000_plus");
      pick("client_region", "Greater London");
      pick("money_urgency", "urgency_same_day");
    });
    await page.waitForTimeout(1200);

    const filtered = await cards(page);
    const eligible = filtered.filter((c) => c.eligible).map((c) => c.name);
    expect(eligible.length, "should narrow, not show everything").toBeLessThan(filtered.length);
    expect(eligible.length).toBeGreaterThan(0);
    // Same-day London means walk in / appointment; courier and home visit are out.
    expect(eligible.join(" | ")).toMatch(/store/i);
  });
});

test.describe("product-finder card filtering", () => {
  test("marks ineligible products as the visitor answers", async ({ page }) => {
    await page.goto("/");
    await setSelect(page, "product-finder", "asset_type", "Gold");
    await setSelect(page, "product-finder", "requested_amount", "amount_250_499");
    await setSelect(page, "product-finder", "money_urgency", "urgency_same_day");
    await setSelect(page, "product-finder", "enquiry_preference", "intent_keep");
    await page.waitForTimeout(1000);

    const state = await page.evaluate(() => {
      const pf = document.querySelector('[data-form="product-finder"]');
      return [...pf.querySelectorAll(".product-card-wrap")].map((w) => ({
        ineligible: /condition-hidden/.test(w.getAttribute("data-form-state") || ""),
        // Ineligible cards are greyed rather than hidden — deliberate here,
        // unlike fulfilment-finder.
        opacity: getComputedStyle(w.querySelector(".product-card")).opacity,
      }));
    });
    const flagged = state.filter((c) => c.ineligible);
    expect(flagged.length, "some products should be ruled out").toBeGreaterThan(0);
    expect(flagged.every((c) => Number(c.opacity) < 1), "ruled-out products are visibly de-emphasised").toBe(true);
  });
});

test.describe("no form creates a stray New_Lead_Type", () => {
  for (const path of ["/", "/fulfilment-finder", "/pawnbroking"]) {
    test(`${path} authors no New_Lead_Type field`, async ({ page }) => {
      await page.goto(path);
      const count = await page.evaluate(() => document.querySelectorAll('[name="New_Lead_Type"]').length);
      expect(count).toBe(0);
    });
  }
});
