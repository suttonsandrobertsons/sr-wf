import { beforeEach, describe, expect, it } from "vitest";

import {
  serialiserGap,
  webflowKeys,
  webflowSerialise,
} from "../webflow-serialise.js";

// These assert the PORT is faithful to Webflow's runtime, not that our forms
// behave well. If one fails after a Webflow runtime update, re-read
// serialiser.extract.js in suttons-robertsons-private/local/webflow-runtime/
// before changing anything here.
describe("webflow serialiser port", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const boot = (html) => {
    document.body.innerHTML = `<form>${html}</form>`;
    return document.querySelector("form");
  };

  it("includes disabled controls, which is where FormData disagrees", () => {
    // The single most consequential difference. Measured live on /get-a-quote:
    // FormData 30 keys, Webflow 49.
    const form = boot(`
      <input name="kept" value="a">
      <input name="hidden_branch" value="stale" disabled>
    `);

    expect(webflowSerialise(form)).toEqual({ kept: "a", hidden_branch: "stale" });
    expect(serialiserGap(form)).toEqual([["hidden_branch", "stale"]]);
  });

  it("collapses duplicate names to the LAST control, not to a list", () => {
    // `fields[key] = value` overwrites. So the declarative single-submit groups
    // (box_and_papers, meeting_venue, appointment_length) submit their final
    // row if the bundle never renames the losers — a deterministic wrong
    // value, not a multi-value field.
    const form = boot(`
      <input name="box_and_papers" value="Original Box and Papers">
      <input name="box_and_papers" value="Original Box Only">
      <input name="box_and_papers" value="None">
    `);

    expect(webflowSerialise(form).box_and_papers).toBe("None");
  });

  it("reads a radio key from the group's checked option, not from position", () => {
    // Text inputs are last-wins, so a duplicate empty one would clobber a real
    // value. Radios are immune: the serialiser sets the key once from
    // `input[name=...]:checked`, then skips every later element of that name.
    const form = boot(`
      <input type="radio" name="mode" value="instant" checked>
      <input type="radio" name="mode" value="describe">
      <input name="note" value="first">
      <input name="note" value="last">
    `);

    const fields = webflowSerialise(form);
    expect(fields.mode).toBe("instant");
    expect(fields.note).toBe("last");
  });

  it("prefers data-name over name", () => {
    // A control rebuilt as a native Designer Form Input gains a data-name from
    // its Designer label, and that label becomes the submitted key.
    const form = boot(`<input data-name="Nice Label" name="machine_name" value="x">`);

    expect(webflowKeys(form)).toEqual(["Nice Label"]);
  });

  it("skips submit, file and button controls", () => {
    const form = boot(`
      <input name="real" value="x">
      <input type="submit" name="submit_btn" value="Send">
      <input type="file" name="upload">
      <input type="button" name="btn" value="Click">
    `);

    expect(webflowKeys(form)).toEqual(["real"]);
  });

  it("serialises a bare <button>, because exclusion is by attribute", () => {
    // `:not([type="submit"])` cannot match a button with no type attribute,
    // so Webflow includes it even though the browser treats it as submit.
    const form = boot(`
      <input name="real" value="x">
      <button name="bare_button">Send</button>
      <button type="submit" name="typed_submit">Send</button>
    `);

    expect(webflowKeys(form)).toEqual(["real", "bare_button"]);
  });

  it("sends empty controls as keys, so absent and empty are different", () => {
    // A key is only absent when no control carries the name. This is why
    // removing the _disabled_ rename would change absent to empty for the
    // no-match case.
    const form = boot(`<input name="blank" value="">`);

    expect(webflowSerialise(form)).toEqual({ blank: "" });
  });

  it("reports checkboxes as booleans and trims strings", () => {
    const form = boot(`
      <input type="checkbox" name="opt_in" checked>
      <input type="checkbox" name="opt_out">
      <input name="padded" value="  spaced  ">
    `);

    expect(webflowSerialise(form)).toEqual({
      opt_in: true,
      opt_out: false,
      padded: "spaced",
    });
  });

  it("reports an unanswered radio group as null", () => {
    const form = boot(`
      <input type="radio" name="choice" value="yes">
      <input type="radio" name="choice" value="no">
    `);

    expect(webflowSerialise(form).choice).toBeNull();
  });

  it("encodes keys only when asked", () => {
    const form = boot(`<input name="odd name" value="x">`);

    expect(webflowKeys(form)).toEqual(["odd name"]);
    expect(webflowKeys(form, { encodeKeys: true })).toEqual(["odd%20name"]);
  });
});
