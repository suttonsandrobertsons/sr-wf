import { expect, test } from "@playwright/test";
import { advanceToEnd } from "./helpers/forms.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Uploads, driven through the real file picker via Playwright's filechooser
// event, so the tests follow the customer's path: formUploads.open(), the temp
// input and its cleanup, focus/cancel detection and the in-progress guard.
//
// These POST to the real Worker and write objects to the R2 bucket. No form is
// submitted, so no lead reaches Zoho, but the objects persist. They are safe to
// leave because:
//
//  1. The content is a synthetic 1x1 JPEG generated here. No customer data,
//     no real photograph, ~200 bytes.
//  2. The folder is labelled. R2 folders follow the lead reference, built
//     from the surname (or "SR" with no name). stampTestReference() sets
//     last_name first, so every object lands under AUTOMATEDTEST-XXXX-XXXX/.
//  3. The filename says so too.
//
// Each full run writes exactly two objects (the third test is rejected before
// the Worker is called). Delete them with the R2 prefix AUTOMATEDTEST-.

const GET_A_QUOTE = "/get-a-quote";

// Set in last_name before the first file is picked: the reference is fixed
// on first file-select.
//
// Letters only. getLeadReference strips non-letters, so a digit would change
// the folder name.
const TEST_SURNAME = "AUTOMATEDTEST";

// A 1x1 JPEG. Small on purpose: the point is the client path, not the bytes.
const JPEG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
  + "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA"
  + "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

/**
 * Open the page and walk to the upload step, with the R2 folder named.
 *
 * The widgets are on step 3 and step-hidden until then, so the picker cannot
 * open earlier.
 *
 * last_name goes through `answers`, which the filler never overwrites;
 * otherwise it would be "test" and objects would land under TEST-.
 */
async function goToUploadStep(page) {
  await page.goto(GET_A_QUOTE);
  await advanceToEnd(page, "get-a-quote", {
    asset_type: "Watches",
    last_name: TEST_SURNAME,
  });

  const widget = page.locator("[data-form-upload]").first();
  await expect(widget, "the upload step should be reachable").toBeVisible({ timeout: 15_000 });

  const surname = await page.evaluate(() =>
    document.querySelector('[data-form="get-a-quote"] [name="last_name"]')?.value);
  expect(surname, "last_name must be set before uploading or R2 gets an unlabelled folder")
    .toBe(TEST_SURNAME);
}

function jpegOnDisk(name = `${TEST_SURNAME}-not-a-real-upload.jpg`) {
  const path = join(mkdtempSync(join(tmpdir(), "sr-e2e-")), name);
  writeFileSync(path, JPEG_1PX);
  return path;
}

/** Click an upload widget's button and answer the picker it opens. */
async function pickFile(page, widgetIndex, filePath) {
  const widget = page.locator("[data-form-upload]").nth(widgetIndex);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    widget.locator("[data-form-upload-trigger]").click(),
  ]);
  await chooser.setFiles(filePath);
  return widget;
}

test.describe("upload widget — the real picker path", () => {
  test("a picked file uploads and populates the widget's value field", async ({ page }) => {
    await goToUploadStep(page);
    const widget = await pickFile(page, 0, jpegOnDisk());

    // The widget reports progress, then settles with a value. The value field
    // is what reaches Zapier.
    await expect
      .poll(async () => widget.locator("[data-form-upload-value-image], [data-form-upload-value-file]")
        .first().inputValue(), { timeout: 30_000 })
      .toMatch(/^https?:\/\//);

    await expect(widget).not.toHaveAttribute("data-form-state", /loading/);

    // The object must be in a folder that identifies it as a test, never one
    // that looks like a real enquiry.
    const storedUrl = await widget
      .locator("[data-form-upload-value-image], [data-form-upload-value-file]")
      .first().inputValue();
    // The Worker percent-encodes the object key, so the folder separators are
    // %2F and a raw "/PREFIX-" never matches. Decode before asserting.
    expect(decodeURIComponent(storedUrl), `uploaded outside the test folder: ${storedUrl}`)
      .toContain(`/uploads/${TEST_SURNAME}-`);
  });

  test("submit is blocked while an upload is in flight", async ({ page }) => {
    // formUploads.validate returns false while any widget is loading, required
    // or not, so a lead never arrives without its file.
    await goToUploadStep(page);
    const widget = await pickFile(page, 0, jpegOnDisk());

    await expect(widget).toHaveAttribute("data-form-state", /loading/, { timeout: 5_000 });

    // Submit is not clicked, as it would post a real lead; the guard's state
    // is asserted instead.
    const loading = await page.evaluate(() => {
      const el = document.querySelector("[data-form-upload]");
      return (el.getAttribute("data-form-state") || "").includes("loading");
    });
    expect(loading).toBe(true);
  });

  test("a rejected file type never reaches the Worker", async ({ page }) => {
    await goToUploadStep(page);
    const path = join(mkdtempSync(join(tmpdir(), "sr-e2e-")), `${TEST_SURNAME}-not-an-image.txt`);
    writeFileSync(path, "plain text");

    const posts = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/upload")) posts.push(r.url());
    });

    const widget = await pickFile(page, 0, path);

    // The widget's rejected state is "invalid", not "error" — setError()
    // sets loading:false, invalid:true, uploaded:false.
    await expect(widget).toHaveAttribute("data-form-state", /invalid/, { timeout: 10_000 });
    expect(posts, "client validation must reject before the Worker call").toEqual([]);
  });
});
