import { test, expect } from "@playwright/test";
import { installSubmitCapture, advanceToEnd } from "./helpers/forms.js";
import { formConfig } from "../src/modules/forms/config.js";

// The price estimate PDF, end to end on the published calculator: the
// Download price estimate link, the PDF it opens, and what submit hands to
// Zapier. Needs the link published in the Gold Form component.
//
// No side effects. Webflow's endpoint is answered by installSubmitCapture, so
// no lead is created, and navigator.sendBeacon is recorded rather than sent,
// so nothing is stored in the quote Worker's bucket. The one real request is
// the GET that renders a PDF, which stores nothing.
//
// SR_COMMIT=<sha> loads that commit of the bundle through the page's own dev
// loader (?commit=), to test a pushed commit before the site is switched to it.

const WORKER = formConfig.quote.workerBase;
const PAGE = `/sell-gold/calculator${process.env.SR_COMMIT ? `?commit=${process.env.SR_COMMIT}` : ""}`;
const LINK = "[data-form-gold-quote-link]";

async function open(page) {
  await page.addInitScript(() => {
    window.__beacons = [];
    navigator.sendBeacon = (url, data) => { window.__beacons.push([String(url), String(data)]); return true; };
  });
  await page.goto(PAGE);
  await page.locator('[data-form="gold"]').waitFor();
}

async function pick(page, scope, value) {
  await page.evaluate(({ scope, value }) => {
    const radio = [...document.querySelector(scope).querySelectorAll('input[type="radio"]')].find((r) => r.value === value);
    radio.checked = true;
    ["input", "change", "click"].forEach((t) => radio.dispatchEvent(new Event(t, { bubbles: true })));
  }, { scope, value });
}

// One 15 g 18ct jewellery item, the same as the golden lead in the twins.
async function priceOneItem(page, enquiry) {
  if (enquiry) await pick(page, '[data-form="gold"]', enquiry);
  await pick(page, '[data-form="gold"] [data-form-gold-item]', "jewellery");
  await page.evaluate(() => {
    const item = document.querySelector('[data-form="gold"] [data-form-gold-item]');
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      ["input", "change"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
    };
    const carat = item.querySelector('[data-form-field="metal_type"] select');
    set(carat, [...carat.options].find((o) => /18/.test(o.textContent)).value);
    set(item.querySelector('[data-form-field="weight_grams"] input'), "15");
  });
  await expect(page.locator(LINK)).toBeVisible();
}

const decode = (href) => JSON.parse(Buffer.from(new URL(href).searchParams.get("d"), "base64url").toString());
const addressOf = (page) => page.evaluate((sel) => {
  const link = document.querySelector(sel);
  link.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  return link.href;
}, LINK);

test("the link stays hidden until an item has a figure", async ({ page }) => {
  await open(page);
  await expect(page.locator(LINK)).toBeHidden();
  await priceOneItem(page, "Sell My Items");
});

test("the link opens a PDF of exactly what the panel shows, with no reference", async ({ page, request }) => {
  await open(page);
  await priceOneItem(page, "Sell My Items");

  const href = await addressOf(page);
  expect(href.startsWith(`${WORKER}/quote?d=`)).toBe(true);
  expect(await page.locator(LINK).getAttribute("target")).toBe("_blank");

  const quote = decode(href);
  const panel = await page.evaluate(() => [...document.querySelectorAll("[data-form-gold-section-price] [data-form-gold-output]")]
    .filter((el) => !el.closest("[data-form-state~='condition-hidden']"))
    .map((el) => [el.getAttribute("data-form-gold-output"), el.textContent.trim()]));
  expect(quote.e).toBe("Sell My Items");
  expect(quote.t).toEqual(panel);
  expect(quote.i).toHaveLength(1);
  expect(quote.i[0].slice(0, 4)).toEqual(["18ct", "Jewellery", "15", "1"]);

  const pdf = await request.get(href);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("submit hands Zapier the Zoho link and beacons the same figures, without waiting", async ({ page }) => {
  const capture = await installSubmitCapture(page);
  await open(page);
  await priceOneItem(page, "Loan");
  const onScreen = decode(await addressOf(page));

  await advanceToEnd(page, "gold", { first_name: "dev", last_name: "dev", email: "dev@dev.com" });
  await page.evaluate(() => document.querySelector('[data-form="gold"] button[type="submit"], [data-form="gold"] input[type="submit"]').click());
  await expect.poll(() => capture.count()).toBe(1);

  const fields = capture.fields();
  const reference = fields.lead_reference[0];
  expect(fields.quote_pdf_url).toEqual([`${WORKER}/quote/${reference}`]);

  const beacons = await page.evaluate(() => window.__beacons.filter(([url]) => url.includes("suttons-quote")));
  expect(beacons).toHaveLength(1);
  expect(beacons[0][0]).toBe(`${WORKER}/quote/${reference}`);
  expect(JSON.parse(Buffer.from(beacons[0][1], "base64url").toString())).toEqual(onScreen);

  await capture.save("gold-price-estimate");
});

test("Describe items has no link, and clears the figures a PDF would use", async ({ page }) => {
  await open(page);
  await priceOneItem(page, "Sell My Items");
  await pick(page, '[data-form="gold"]', "describe");
  await expect(page.locator(LINK)).toBeHidden();
  // Cleared on the next recalculation, which submit also runs first.
  await expect.poll(() => page.locator('[data-form="gold"] [name="bullion_name_1"]').inputValue()).toBe("");
});
