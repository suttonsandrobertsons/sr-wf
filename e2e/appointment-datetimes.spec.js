import { test, expect } from "@playwright/test";
import { installSubmitCapture, fillAndSubmit } from "./helpers/forms.js";

// appointment_length and meeting_venue are set by
// submit-values/business-rules.js, not by Designer inputs.
//
// appointment_length feeds appointment_end_datetime, which the Zap maps to
// Zoho's End_DateTime. That field is mandatory on Zoho Events, so an empty end
// time means no Event is created.
//
// No lead is created: installSubmitCapture answers Webflow's endpoint itself.

const PAGES = [
  { path: "/find-us/make-an-appointment", label: "make-an-appointment" },
  // Three instances of the Book Appointment component, to confirm a component
  // edit reaches each one.
  { path: "/about/contact", label: "about-contact" },
];

// Both rows the rule can reach on a real form, with the end time they imply.
const LENGTHS = [
  { subType: "Drop off (15 minutes)", minutes: 15, endsAt: "10:45:00" },
  { subType: "Full consultation (30 to 60 minutes)", minutes: 60, endsAt: "11:30:00" },
];

const ANSWERS = {
  appointment_type: "Victoria, London",
  appointment_date: "2026-11-12",
  appointment_time: "10:30",
  quote_received: "No",
};

for (const page_ of PAGES) {
  test.describe(`appointment datetimes — ${page_.label}`, () => {
    for (const { subType, minutes, endsAt } of LENGTHS) {
      test(`a ${minutes}-minute booking sends a matching end datetime`, async ({ page }) => {
        const capture = await installSubmitCapture(page);
        await page.goto(page_.path);

        const fields = await fillAndSubmit(page, "appointment", {
          ...ANSWERS,
          appointment_sub_type: subType,
        }).then(() => capture.fields());

        expect(capture.count(), "the form should have submitted once").toBe(1);
        expect(capture.one(fields, "appointment_length")).toBe(String(minutes));
        expect(capture.one(fields, "appointment_start_datetime")).toBe("2026-11-12T10:30:00");
        expect(capture.one(fields, "appointment_end_datetime")).toBe(`2026-11-12T${endsAt}`);

        // An empty end datetime means no Zoho Event, so assert non-empty
        // directly, not only by equality.
        expect(capture.one(fields, "appointment_end_datetime")).toBeTruthy();
      });
    }

    test("a home visit takes the type row and records the client's location", async ({ page }) => {
      // appointment_sub_type is condition-hidden for a home visit, so the rule
      // falls through to its third row: appointment_type = Home visit -> 60.
      const capture = await installSubmitCapture(page);
      await page.goto(page_.path);

      const fields = await fillAndSubmit(page, "appointment", {
        ...ANSWERS,
        appointment_type: "Home visit or private office",
      }).then(() => capture.fields());

      expect(capture.one(fields, "appointment_length")).toBe("60");
      expect(capture.one(fields, "appointment_end_datetime")).toBe("2026-11-12T11:30:00");
      expect(capture.one(fields, "meeting_venue")).toBe("Client location");

      await capture.save(`appointment-${page_.label}`);
    });

    test("the authored inputs are gone from the published page", async ({ page }) => {
      // Re-adding any would beat the computed value: duplicates collapse to
      // the last in DOM order, and the computed hidden is appended first.
      await page.goto(page_.path);
      const counts = await page.evaluate(() => {
        const form = document.querySelector('[data-form="appointment"]');
        const n = (name) => form.querySelectorAll(`[name="${name}"]`).length;
        return {
          appointment_length: n("appointment_length") + n("_disabled_appointment_length"),
          meeting_venue: n("meeting_venue") + n("_disabled_meeting_venue"),
          sources: n("appointment_type") + n("appointment_sub_type"),
        };
      });

      expect(counts.appointment_length, "no authored appointment_length may exist").toBe(0);
      expect(counts.meeting_venue).toBe(0);
      expect(counts.sources, "the rules read these — they must stay").toBeGreaterThan(0);
    });
  });
}
