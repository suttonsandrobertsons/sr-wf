import { test, expect } from "@playwright/test";

const ANY_PAGE = "/dev/forms/gold-calculator"; // footer form is on every page

test.describe("footer newsletter validation", () => {
  test("rejects an invalid email address (no submission)", async ({ page }) => {
    await page.goto(ANY_PAGE);
    const form = page.locator('[data-form="footer-form"], #footer-form').first();
    const email = form.locator('input[name="email"]');
    await email.fill("notanemail");

    await form.locator('[type="submit"]').first().click();

    // The field is flagged invalid and the success block stays hidden.
    await expect(form.locator(".w-form-done")).toBeHidden();
    const flaggedInvalid = await email.evaluate(
      (el) =>
        el.getAttribute("aria-invalid") === "true" ||
        /invalid|error/.test(el.getAttribute("data-form-state") || "") ||
        !el.checkValidity()
    );
    expect(flaggedInvalid).toBe(true);
  });

  test("accepts a well-formed email as valid input (no submit)", async ({
    page,
  }) => {
    await page.goto(ANY_PAGE);
    const form = page.locator('[data-form="footer-form"], #footer-form').first();
    const email = form.locator('input[name="email"]');
    await email.fill("valid.person@example.com");
    // Not submitted, as that would subscribe a real address.
    const valid = await email.evaluate((el) => el.checkValidity());
    expect(valid).toBe(true);
  });
});
