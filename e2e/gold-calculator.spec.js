import { test, expect } from "@playwright/test";

// The /dev/forms/ page is a single-item calculator harness (no add-item,
// upload, or continue nav), so multi-item, upload and step behaviour is not
// covered here — those need the full multi-step form page.
const GOLD_CALC = "/dev/forms/gold-calculator";

async function setRadioByValue(page, scopeSelector, value) {
  await page.evaluate(
    ({ scopeSelector, value }) => {
      const scope = document.querySelector(scopeSelector);
      const r = [...scope.querySelectorAll('input[type="radio"]')].find(
        (x) => x.value === value
      );
      if (!r) throw new Error(`radio value="${value}" not in ${scopeSelector}`);
      r.checked = true;
      ["input", "change", "click"].forEach((t) =>
        r.dispatchEvent(new Event(t, { bubbles: true }))
      );
    },
    { scopeSelector, value }
  );
}

async function fillJewellery(page, { carat, weight, qty }) {
  await page.evaluate(
    ({ carat, weight, qty }) => {
      const gf = document.querySelector('[data-form="gold"]');
      const fire = (el) =>
        ["input", "change"].forEach((t) =>
          el.dispatchEvent(new Event(t, { bubbles: true }))
        );
      const setVal = (el, v) => {
        const proto =
          el.tagName === "SELECT"
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
        fire(el);
      };
      setVal(gf.querySelector('[name="gold_metal_type_1"]'), carat);
      setVal(gf.querySelector('[name="gold_weight_grams_1"]'), weight);
      const q = gf.querySelector('[name="gold_quantity_1"]');
      if (q) setVal(q, qty);
    },
    { carat, weight, qty }
  );
}

async function fillJewelleryItem(page, enquiry, opts) {
  await setRadioByValue(page, '[data-form="gold"]', enquiry);
  await setRadioByValue(page, "[data-form-gold-item]", "jewellery");
  await expect(
    page.locator('[data-form-gold-item] [data-form-field="metal_type"]').first()
  ).toBeVisible();
  await fillJewellery(page, opts);
}

// What the page would submit, by Webflow's rules rather than FormData's.
// FormData omits disabled controls; Webflow does not, which here means every
// condition-hidden per-slot field. Mirrors
// src/modules/forms/__tests__/helpers/webflow-submit.js.
function readEmit(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-form="gold"]');
    const skipped = new Set(['submit', 'file', 'button']);
    const fields = {};
    let index = 0;

    root.querySelectorAll('input, select, textarea, button').forEach((control) => {
      const type = String(control.getAttribute('type') || '').toLowerCase();
      if (skipped.has(type)) return;

      index += 1;
      const key = control.getAttribute('data-name') || control.getAttribute('name') || `Field ${index}`;
      let value = control.value;

      if (type === 'checkbox') {
        value = control.checked;
      } else if (type === 'radio') {
        if (fields[key] === null || typeof fields[key] === 'string') return;
        const checked = root.querySelector(`input[name="${control.getAttribute('name')}"]:checked`);
        value = checked ? checked.value : null;
      }

      if (typeof value === 'string') value = value.trim();
      fields[key] = value;
    });

    return fields;
  });
}

async function pollForTotal(page, field) {
  await expect
    .poll(async () => (await readEmit(page))[field], { timeout: 15_000 })
    .toMatch(/^[1-9]\d*$/);
}

test.describe("gold calculator (published site)", () => {
  test("condition rules toggle field visibility (carat vs bullion)", async ({
    page,
  }) => {
    await page.goto(GOLD_CALC);
    const item = page.locator("[data-form-gold-item]").first();
    const carat = item.locator('[data-form-field="metal_type"]');
    const bullion = item.locator('[data-form-field="bullion_name"]').first();

    await expect(carat).toBeHidden();
    await expect(bullion).toBeHidden();

    await setRadioByValue(page, "[data-form-gold-item]", "jewellery");
    await expect(carat).toBeVisible();
    await expect(bullion).toBeHidden();

    await setRadioByValue(page, "[data-form-gold-item]", "coin");
    await expect(bullion).toBeVisible();
    await expect(carat).toBeHidden();
  });

  // "Other" is not a carat option: it has no pricing row.
  test('carat select does not offer "Other"', async ({ page }) => {
    await page.goto(GOLD_CALC);
    await setRadioByValue(page, "[data-form-gold-item]", "jewellery");
    const carat = page.locator('[name="gold_metal_type_1"]');
    await expect(carat).toBeVisible();
    const values = await carat
      .locator("option")
      .evaluateAll((os) => os.map((o) => o.value));
    expect(values).not.toContain("Other");
    expect(values).toEqual(expect.arrayContaining(["9", "14", "18", "22", "24"]));
  });

  test("loan estimate emits whole-£ amounts, per-item amount, asset type", async ({
    page,
  }) => {
    await page.goto(GOLD_CALC);
    await fillJewelleryItem(page, "Loan", { carat: "18", weight: "15", qty: "1" });
    await pollForTotal(page, "gold_loan_total");

    const e = await readEmit(page);
    expect(e.gold_purchase_total).toMatch(/^\d+$/);
    expect(e.gold_loan_total).toMatch(/^\d+$/);
    expect(e.gold_total).toMatch(/^\d+$/);
    expect(e.gold_item_1_asset_type).toBe("Gold");
    expect(e.gold_item_1_amount).toBe(e.gold_loan_total);
    expect(e.gold_item_1_type).toBe("Jewellery"); // Zoho picklist case
    expect(e.gold_interest_rate).toMatch(/^\d+\.\d$/);
  });

  test("sell enquiry flips amounts to purchase and shows the estimate row", async ({
    page,
  }) => {
    await page.goto(GOLD_CALC);
    await fillJewelleryItem(page, "Sell My Items", {
      carat: "18",
      weight: "15",
      qty: "1",
    });
    await pollForTotal(page, "gold_purchase_total");

    const e = await readEmit(page);
    expect(e.gold_total).toBe(e.gold_purchase_total);
    expect(e.gold_item_1_amount).toBe(e.gold_purchase_total);
    await expect(page.locator(".form-gold_estimate-row").first()).toBeVisible();
  });

  // 3% spot discount before the purchase (86% jewellery) and 75% loan ratios.
  // A rounding-tolerant band that fails if the discount or a ratio changes.
  test("purchase/loan sit at the discounted ratios vs raw spot", async ({
    page,
  }) => {
    await page.goto(GOLD_CALC);
    await fillJewelleryItem(page, "Loan", { carat: "18", weight: "20", qty: "1" });
    await pollForTotal(page, "gold_loan_total");

    const e = await readEmit(page);
    const spot = Number(e.gold_item_1_spot_value);
    const purchaseRatio = Number(e.gold_item_1_purchase_value) / spot;
    const loanRatio = Number(e.gold_item_1_loan_value) / spot;
    // Jewellery: 0.97 spot discount x 0.86 purchase rate = 0.8342.
    expect(purchaseRatio).toBeGreaterThan(0.825);
    expect(purchaseRatio).toBeLessThan(0.845); // rejects 0.86 (no discount)
    // Loan keeps the flat 75%: 0.97 x 0.75 = 0.7275.
    expect(loanRatio).toBeGreaterThan(0.72);
    expect(loanRatio).toBeLessThan(0.735); // rejects 0.75 (no discount)
  });

  // Empty item slots emit blank amount/asset type, so Zoho gets no empty line items.
  test("unused item slots emit blank amount and asset type", async ({
    page,
  }) => {
    await page.goto(GOLD_CALC);
    await fillJewelleryItem(page, "Loan", { carat: "18", weight: "15", qty: "1" });
    await pollForTotal(page, "gold_loan_total");

    const e = await readEmit(page);
    for (const i of [2, 3, 4, 5]) {
      expect(e[`gold_item_${i}_amount`]).toBe("");
      expect(e[`gold_item_${i}_asset_type`]).toBe("");
    }
  });

  async function fillCoin(page, enquiry, bullion) {
    await setRadioByValue(page, '[data-form="gold"]', enquiry);
    await setRadioByValue(page, "[data-form-gold-item]", "coin");
    await page.evaluate((bullion) => {
      const gf = document.querySelector('[data-form="gold"]');
      const fire = (el) =>
        ["input", "change"].forEach((t) =>
          el.dispatchEvent(new Event(t, { bubbles: true }))
        );
      const setVal = (el, proto, v) => {
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
        fire(el);
      };
      // The active bullion select is the visible one inside the bullion field
      // (the field-group logic hides/renames the others), so target by
      // visibility rather than a fixed name.
      const sel = [...gf.querySelectorAll('[data-form-field="bullion_name"] select')].find(
        (s) => s.offsetParent !== null
      );
      setVal(sel, HTMLSelectElement.prototype, bullion);
      const q = gf.querySelector('[name="gold_quantity_1"]');
      if (q) setVal(q, HTMLInputElement.prototype, "1");
    }, bullion);
  }

  // Swiss/French Francs and Gold American Eagles carry a further 6% on the 88%
  // purchase / 75% loan offers, set per CMS pricing row (extra-discount).
  // Against raw spot: purchase ≈ 0.97×0.88×0.94 = 0.802, loan ≈ 0.97×0.75×0.94 = 0.684.
  test("coin-group discount trims Francs/Eagles ~6% below the standard ratios", async ({
    page,
  }) => {
    await page.goto(GOLD_CALC);
    await fillCoin(page, "Loan", "1_oz_gold_american_eagle");
    await pollForTotal(page, "gold_loan_total");

    const e = await readEmit(page);
    const spot = Number(e.gold_item_1_spot_value);
    expect(Number(e.gold_item_1_purchase_value) / spot).toBeGreaterThan(0.79);
    expect(Number(e.gold_item_1_purchase_value) / spot).toBeLessThan(0.825); // rejects ~0.85 (no group discount)
    expect(Number(e.gold_item_1_loan_value) / spot).toBeGreaterThan(0.675);
    expect(Number(e.gold_item_1_loan_value) / spot).toBeLessThan(0.705); // rejects ~0.73 (no group discount)
  });

  // Control: an unflagged coin (Sovereign) keeps the standard ratios, so the
  // group discount is targeted.
  test("a non-flagged coin (Sovereign) keeps the standard ratios", async ({
    page,
  }) => {
    await page.goto(GOLD_CALC);
    await fillCoin(page, "Loan", "gold_sovereign");
    await pollForTotal(page, "gold_loan_total");

    const e = await readEmit(page);
    const spot = Number(e.gold_item_1_spot_value);
    expect(Number(e.gold_item_1_purchase_value) / spot).toBeGreaterThan(0.85); // ~0.854
    expect(Number(e.gold_item_1_purchase_value) / spot).toBeLessThan(0.875);
    expect(Number(e.gold_item_1_loan_value) / spot).toBeGreaterThan(0.72); // ~0.728
    expect(Number(e.gold_item_1_loan_value) / spot).toBeLessThan(0.745);
  });
});
