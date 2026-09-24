import { test, expect } from "@playwright/test";

const GOLD_CALC = "/dev/forms/gold-calculator";

function optionsLocator(page) {
  const native = page.locator('select[name="phone_country_code"]');
  return page
    .locator("[data-form-select]")
    .filter({ has: native })
    .locator("[data-form-select-option]");
}

test.describe("phone country-code dropdown (CMS-driven)", () => {
  test("renders the full country list, each with a flag", async ({ page }) => {
    await page.goto(GOLD_CALC);
    const options = optionsLocator(page);

    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(100);

    const withFlag = await options
      .locator("img[data-form-select-option-icon]")
      .evaluateAll((imgs) => imgs.filter((i) => i.src && i.src.length > 10).length);
    expect(withFlag).toBe(count);
  });

  test("defaults to +44 (UK)", async ({ page }) => {
    await page.goto(GOLD_CALC);
    const native = page.locator('select[name="phone_country_code"]');
    await expect(native).toHaveValue("+44");
  });

  test("has no duplicate dial-code values (invariant)", async ({ page }) => {
    await page.goto(GOLD_CALC);
    const values = await optionsLocator(page).evaluateAll((os) =>
      os.map((o) => o.getAttribute("data-form-select-option"))
    );
    // Duplicate values would collide option ids and make selection ambiguous,
    // e.g. if a shared dial code is added in the CMS.
    expect(new Set(values).size).toBe(values.length);
  });

  test("includes representative newly-added dial codes", async ({ page }) => {
    await page.goto(GOLD_CALC);
    for (const code of ["+974", "+62", "+380", "+212", "+886"]) {
      await expect(
        page.locator(`[data-form-select-option="${code}"]`).first()
      ).toHaveCount(1);
    }
  });
});
