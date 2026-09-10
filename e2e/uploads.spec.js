import { expect, test } from "@playwright/test";
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
// These POST to the real Worker and write real objects to R2 under a test
// reference. They do NOT submit a form, so no lead reaches Zoho.

const GET_A_QUOTE = "/get-a-quote";

// A 1x1 JPEG. Small on purpose: the point is the client path, not the bytes.
const JPEG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
  + "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA"
  + "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

function jpegOnDisk(name = "qa-upload.jpg") {
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
    await page.goto(GET_A_QUOTE);
    const widget = await pickFile(page, 0, jpegOnDisk());

    // The widget reports progress, then settles with a value. The value field is
    // what actually reaches Zapier; an empty one means the customer sees a
    // thumbnail and the CRM gets nothing.
    await expect
      .poll(async () => widget.locator("[data-form-upload-value-image], [data-form-upload-value-file]")
        .first().inputValue(), { timeout: 30_000 })
      .toMatch(/^https?:\/\//);

    await expect(widget).not.toHaveAttribute("data-form-state", /loading/);
  });

  test("submit is blocked while an upload is in flight", async ({ page }) => {
    // formUploads.validate returns false whenever a widget is loading, whether
    // or not the field is required — otherwise the form hands off with an empty
    // URL and the lead arrives with no file.
    await page.goto(GET_A_QUOTE);
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
    await page.goto(GET_A_QUOTE);
    const path = join(mkdtempSync(join(tmpdir(), "sr-e2e-")), "not-an-image.txt");
    writeFileSync(path, "plain text");

    const posts = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/upload")) posts.push(r.url());
    });

    const widget = await pickFile(page, 0, path);

    await expect(widget).toHaveAttribute("data-form-state", /error/, { timeout: 10_000 });
    expect(posts, "client validation must reject before the Worker call").toEqual([]);
  });
});
