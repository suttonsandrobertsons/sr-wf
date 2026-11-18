import { beforeEach, afterEach, expect, it, vi } from "vitest";
let api, queries, timelines, fail;
function item(id = "a") {
  return `<div data-accordion="item" id="${id}" style="color: red"><button data-accordion="trigger" aria-label="Question">Question</button><div data-accordion="content" style="padding: 7px"><a href="#answer">Answer</a></div><i data-accordion="icon" style="color: blue"></i></div>`;
}
function gsapStub() {
  return { set(el, vars) {
    if (fail === "set") {
      el.style.height = "0px";
      throw Error("set");
    }
    for (const [k, v] of Object.entries(vars)) {
      if (k === "height") el.style.height = typeof v === "number" ? `${v}px` : v;
      if (k === "overflow") el.style.overflow = v;
      if (k === "rotation") el.style.transform = `rotate(${v}deg)`;
    }
  }, timeline() {
    const t = { fromTo(el, from) {
      if ("height" in from) el.style.height = "0px";
      if (fail === "timeline") throw Error("timeline");
      return t;
    }, progress() {
      return t;
    }, pause() {
      return t;
    }, kill() {
      return t;
    }, invalidate() {
      if (fail === "runtime") throw Error("runtime");
      return t;
    }, play() {
      return t;
    }, reverse() {
      return t;
    } };
    timelines.push(t);
    return t;
  } };
}
beforeEach(async () => {
  vi.resetModules();
  fail = null;
  queries = [];
  timelines = [];
  const mqMap = /* @__PURE__ */ new Map();
  vi.stubGlobal("matchMedia", (query) => {
    if (mqMap.has(query)) return mqMap.get(query);
    const mq = { matches: true, listeners: /* @__PURE__ */ new Set(), addEventListener(_, f) {
      this.listeners.add(f);
    }, removeEventListener(_, f) {
      this.listeners.delete(f);
    } };
    queries.push(mq);
    mqMap.set(query, mq);
    return mq;
  });
  vi.stubGlobal("gsap", gsapStub());
  vi.spyOn(console, "warn").mockImplementation(() => {
  });
  vi.spyOn(console, "error").mockImplementation(() => {
  });
  document.body.innerHTML = `<section data-accordion="component">${item()}</section>`;
  api = await import("../accordions.js");
});
afterEach(() => {
  api.destroyAccordions();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("leaves missing-GSAP answers unmarked and readable", () => {
  vi.stubGlobal("gsap", void 0);
  api.initAccordions();
  expect(document.querySelector("[data-accordion-ready]")).toBeNull();
  expect(document.querySelector('[data-accordion="content"]').style.height).toBe("");
});
it("marks working items and restricts closed links, restoring authored state on destroy", () => {
  api.initAccordions();
  const el = document.querySelector("#a"), content = el.querySelector('[data-accordion="content"]'), button = el.querySelector("button");
  expect(el.dataset.accordionReady).toBe("true");
  expect(content.hasAttribute("inert")).toBe(true);
  expect(content.getAttribute("aria-hidden")).toBe("true");
  button.click();
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(content.hasAttribute("inert")).toBe(false);
  expect(content.getAttribute("aria-hidden")).toBe("false");
  api.destroyAccordions();
  expect(el.hasAttribute("data-accordion-ready")).toBe(false);
  expect(content.style.height).toBe("");
  expect(content.style.padding).toBe("7px");
  expect(content.hasAttribute("aria-hidden")).toBe(false);
  expect(content.hasAttribute("inert")).toBe(false);
  expect(button.getAttribute("aria-label")).toBe("Question");
  expect(button.hasAttribute("aria-expanded")).toBe(false);
});
it.each(["timeline", "set"])("restores partial %s mutations and initialises a separate sibling", (mode) => {
  document.body.innerHTML += `<section data-accordion="component">${item("b")}</section>`;
  fail = mode;
  api.initAccordions(document.querySelector("section"));
  fail = null;
  api.initAccordions(document.querySelectorAll("section")[1]);
  expect(document.querySelector('#a [data-accordion="content"]').style.height).toBe("");
  expect(document.querySelector("#a").hasAttribute("data-accordion-ready")).toBe(false);
  expect(document.querySelector("#b").dataset.accordionReady).toBe("true");
});
it("restores readable state when a click fails after setup", () => {
  api.initAccordions();
  fail = "runtime";
  document.querySelector("button").click();
  expect(document.querySelector("[data-accordion-ready]")).toBeNull();
  expect(document.querySelector('[data-accordion="content"]').hasAttribute("inert")).toBe(false);
  expect(document.querySelector('[data-accordion="content"]').style.height).toBe("");
});
it("deactivates at breakpoints and safely restores authored ARIA and inline properties", () => {
  const root = document.querySelector("section"), content = root.querySelector('[data-accordion="content"]');
  root.dataset.accordionBreakpoints = "mbp";
  content.setAttribute("aria-hidden", "false");
  content.style.setProperty("overflow", "visible", "important");
  api.initAccordions();
  const mq = queries[0];
  mq.matches = false;
  for (const fn of mq.listeners) fn();
  expect(root.querySelector("[data-accordion-ready]")).toBeNull();
  expect(content.style.height).toBe("");
  expect(content.style.getPropertyPriority("overflow")).toBe("important");
  expect(content.getAttribute("aria-hidden")).toBe("false");
  mq.matches = true;
  for (const fn of mq.listeners) fn();
  expect(root.querySelector("[data-accordion-ready]")).not.toBeNull();
});
it("owns nested items once without borrowing a child trigger", () => {
  document.body.innerHTML = `<section data-accordion="component"><div data-accordion="item" id="outer"><section data-accordion="component">${item("inner")}</section></div>${item("peer")}</section>`;
  api.initAccordions();
  expect(document.querySelector("#outer").hasAttribute("data-accordion-ready")).toBe(false);
  expect(document.querySelector("#inner").dataset.accordionReady).toBe("true");
  expect(api.getAccordionInstances().flatMap((i) => i.items).filter((r) => r.item.id === "inner")).toHaveLength(1);
});
it("makes real DIV triggers keyboard-operable and restores authored semantics on destroy", () => {
  const root = document.querySelector("section");
  root.innerHTML = item().replace('<button data-accordion="trigger" aria-label="Question">Question</button>', '<div data-accordion="trigger" aria-label="Question" role="heading" tabindex="-1">Question</div>');
  api.initAccordions();
  const trigger = root.querySelector('[data-accordion="trigger"]'), content = root.querySelector('[data-accordion="content"]');
  expect(trigger.getAttribute("role")).toBe("button");
  expect(trigger.tabIndex).toBe(0);
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  trigger.dispatchEvent(enter);
  expect(enter.defaultPrevented).toBe(true);
  expect(content.hasAttribute("inert")).toBe(false);
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
  expect(content.hasAttribute("inert")).toBe(true);
  api.destroyAccordions();
  expect(trigger.getAttribute("role")).toBe("heading");
  expect(trigger.getAttribute("tabindex")).toBe("-1");
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(trigger.hasAttribute("aria-expanded")).toBe(false);
});
it("ignores stale accordion destroy and media callbacks after a new instance is working", () => {
  const root = document.querySelector("section");
  root.dataset.accordionBreakpoints = "mbp";
  const old = api.createAccordion(root);
  old.destroy();
  const current = api.createAccordion(root);
  old.destroy();
  old.evaluateBreakpointState();
  expect(root._accordionInstance).toBe(current);
  expect(api.getAccordionInstances()).toEqual([current]);
  expect(root.querySelector("[data-accordion-ready]")).not.toBeNull();
});
it("restores authored independent transform properties after GSAP icon cleanup", () => {
  const icon = document.querySelector('[data-accordion="icon"]');
  icon.style.translate = "2px";
  icon.style.rotate = "3deg";
  icon.style.scale = "1.2";
  icon.setAttribute("transform", "translate(1, 2)");
  const original = gsap.set;
  gsap.set = (el, vars) => {
    original(el, vars);
    if ("rotation" in vars) {
      el.style.translate = "none";
      el.style.rotate = "none";
      el.style.scale = "none";
      el.setAttribute("transform", "matrix(1,0,0,1,0,0)");
      el.setAttribute("data-svg-origin", "0 0");
    }
  };
  api.initAccordions();
  api.destroyAccordions();
  expect(icon.style.translate).toBe("2px");
  expect(icon.style.rotate).toBe("3deg");
  expect(icon.style.scale).toBe("1.2");
  expect(icon.getAttribute("transform")).toBe("translate(1, 2)");
  expect(icon.hasAttribute("data-svg-origin")).toBe(false);
});
