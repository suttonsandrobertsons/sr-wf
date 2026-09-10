import { expect, test } from "@playwright/test";
import { advanceToEnd } from "./helpers/forms.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Uploads, driven through the real file picker.
//
// Replaces the sr.forms.injectUpload hook, deleted 9 Sep 2026. That hook shipped
// to every live page and called formUploads.handle() directly, so it skipped
// formUploads.open() and everything the real path does: createTempInput, the
// temp-input lifecycle, focus/cancel detection, handleTempInputChange, the
// in-progress guard, and the stale-input cleanup.
//
// Playwright's filechooser event drives the widget's own picker, so these tests
// exercise the path a customer takes. The hook's premise — that browser
// automation cannot drive a native file picker — was never true here.
//
// CLIENT SAFETY. These POST to the real Worker and write real objects into the
// client's R2 bucket. They do NOT submit a form, so no lead reaches Zoho, but
// the objects are real and they persist. Three things keep them safe to leave:
//
//  1. The content is a synthetic 1x1 JPEG generated here. No customer data,
//     no real photograph, ~200 bytes.
//  2. The FOLDER is labelled. R2 is organised by lead reference, and
//     getLeadReference builds that from the surname — falling back to "SR"
//     when there is no name, which is indistinguishable from a real enquiry.
//     stampTestReference() sets last_name first, so every object lands under
//     AUTOMATEDTEST-XXXX-XXXX/ and the whole run can be found and deleted
//     by prefix.
//  3. The filename says so too.
//
// Each full run writes exactly two objects (the third test is rejected before
// the Worker is called). Delete them with the R2 prefix AUTOMATEDTEST-.

const GET_A_QUOTE = "/get-a-quote";

// Written into last_name BEFORE the first file is picked. The reference is
// generated once per form on file-select and cached, so this has to happen
// first or the folder is already named.
//
// LETTERS ONLY. getLeadReference strips the surname to /[^A-Z]/, so "E2ETEST"
// silently became the folder "EETEST-..." on the first real run and this
// spec's own folder assertion caught it. Do not put a digit in here.
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
 * The widgets live on step 3. Until the form is walked there they are
 * step-hidden, so Playwright's actionability check never resolves, the click
 * never lands and waitForEvent("filechooser") times out — which is exactly how
 * all three of these failed the first time they were ever run.
 *
 * last_name goes through `answers`, which the driver pins: its generic filler
 * would otherwise put "test" in every unrecognised text input and the objects
 * would land under TEST- instead of AUTOMATEDTEST-.
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

    // The widget reports progress, then settles with a value. The value field is
    // what actually reaches Zapier; an empty one means the customer sees a
    // thumbnail and the CRM gets nothing.
    await expect
      .poll(async () => widget.locator("[data-form-upload-value-image], [data-form-upload-value-file]")
        .first().inputValue(), { timeout: 30_000 })
      .toMatch(/^https?:\/\//);

    await expect(widget).not.toHaveAttribute("data-form-state", /loading/);

    // The safety property, asserted rather than assumed: the object must be in
    // a folder this run can be identified by. If the reference ever stops
    // deriving from last_name, this fails here instead of quietly seeding the
    // client's bucket with objects that look like real enquiries.
    const storedUrl = await widget
      .locator("[data-form-upload-value-image], [data-form-upload-value-file]")
      .first().inputValue();
    // The Worker percent-encodes the object key, so the folder separators are
    // %2F and a raw "/PREFIX-" never matches. Decode before asserting.
    expect(decodeURIComponent(storedUrl), `uploaded outside the test folder: ${storedUrl}`)
      .toContain(`/uploads/${TEST_SURNAME}-`);
  });

  test("submit is blocked while an upload is in flight", async ({ page }) => {
    // formUploads.validate returns false whenever a widget is loading, whether
    // or not the field is required — otherwise the form hands off with an empty
    // URL and the lead arrives with no file.
    await goToUploadStep(page);
    const widget = await pickFile(page, 0, jpegOnDisk());

    await expect(widget).toHaveAttribute("data-form-state", /loading/, { timeout: 5_000 });

    // Do NOT click submit: a successful submit posts a real lead. Assert the
    // guard's own state instead.
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
