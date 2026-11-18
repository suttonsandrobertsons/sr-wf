import { beforeEach, afterEach, it, expect, vi } from "vitest";
let clock, callbacks, a, m, f;
function gate() {
  const api = { deadline: 4e3, expired: false, reason: null, canEnhance() {
    if (clock >= 4e3) this.fallback("timeout");
    return !this.expired;
  }, register(root, fn) {
    if (!this.canEnhance()) {
      fn();
      return () => {
      };
    }
    callbacks.add(fn);
    return () => callbacks.delete(fn);
  }, fallback(reason = "timeout") {
    this.expired = true;
    this.reason = reason;
    for (const fn of [...callbacks]) {
      callbacks.delete(fn);
      fn();
    }
  } };
  return api;
}
function markup(count = 5) {
  return `<section data-faq-split="component" data-accordion="component" data-load-more="component" data-load-more-initial-count="2" data-load-more-count="2"><div data-faq-split="source">${Array.from({ length: count }, (_, i) => `<article data-accordion="item" data-faq-split="item" data-load-more="item"><button data-accordion="trigger">Q${i}</button><div data-accordion="content"><a href="#a">A${i}</a></div></article>`).join("")}</div><div class="faq_list-split-wrap"><div data-faq-split="target-1"></div><div data-faq-split="target-2"></div></div><button data-load-more="trigger">More</button></section>`;
}
function fakeGsap() {
  return { set(el, v) {
    if ("height" in v) el.style.height = typeof v.height === "number" ? v.height + "px" : v.height;
    if (v.overflow) el.style.overflow = v.overflow;
  }, timeline() {
    const t = { fromTo(el, from) {
      if ("height" in from) el.style.height = "0px";
      return t;
    }, progress() {
      return t;
    }, pause() {
      return t;
    }, kill() {
      return t;
    }, invalidate() {
      return t;
    }, play() {
      return t;
    }, reverse() {
      return t;
    } };
    return t;
  } };
}
beforeEach(async () => {
  vi.resetModules();
  clock = 0;
  callbacks = /* @__PURE__ */ new Set();
  window.sr = { componentStartup: gate() };
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {
  }, removeEventListener() {
  } }));
  vi.stubGlobal("gsap", fakeGsap());
  vi.spyOn(console, "warn").mockImplementation(() => {
  });
  document.body.innerHTML = markup();
  document.documentElement.classList.add("sr-page-loaded");
  a = await import("../accordions.js");
  m = await import("../load-more.js");
  f = await import("../faq.js");
});
afterEach(() => {
  f.destroyFaq();
  m.destroyLoadMore();
  a.destroyAccordions();
  delete window.sr;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("refuses first accordion, FAQ Load more and split after absolute expiry without mutations", () => {
  clock = 4001;
  const root = document.querySelector("section"), source = root.firstElementChild, nodes = [...source.children];
  a.initAccordions();
  m.initLoadMore();
  f.initFaq();
  expect(root.dataset.faqStartupState).toBe("fallback");
  expect(root.querySelector('[data-faq-split="source"]')).toBe(source);
  expect([...source.children]).toEqual(nodes);
  expect(root.querySelectorAll("[hidden],[inert],[data-accordion-ready]")).toHaveLength(0);
  expect(root.querySelector('[data-accordion="content"]').style.height).toBe("");
});
it("restores the complete pending FAQ on timeout between modules and never reenhances", () => {
  const root = document.querySelector("section"), source = root.firstElementChild, nodes = [...source.children];
  a.initAccordions();
  m.initLoadMore();
  expect(root.querySelectorAll("[hidden]")).toHaveLength(3);
  clock = 4001;
  window.sr.componentStartup.fallback();
  f.initFaq();
  a.initAccordions();
  m.initLoadMore();
  expect(root.dataset.faqStartupState).toBe("fallback");
  expect(root.querySelectorAll("[hidden],[inert],[data-accordion-ready]")).toHaveLength(0);
  expect(root.querySelector('[data-faq-split="source"]')).toBe(source);
  expect([...source.children]).toEqual(nodes);
});
it("finishes split without waiting for window.load and keeps healthy callbacks after expiry", () => {
  document.documentElement.classList.remove("sr-page-loaded");
  const root = document.querySelector("section");
  a.initAccordions();
  m.initLoadMore();
  f.initFaq();
  expect(root.dataset.faqSplitState).toBe("desktop");
  expect(root.dataset.faqStartupState).toBe("managed");
  expect(callbacks.size).toBe(0);
  clock = 5e3;
  window.sr.componentStartup.fallback();
  root.querySelector('[data-load-more="trigger"]').click();
  expect(root.querySelectorAll("[hidden]")).toHaveLength(1);
  expect(root.querySelectorAll("[data-accordion-ready]")).toHaveLength(5);
});
it("makes a missing-GSAP FAQ terminal and preserves unrelated Load more", () => {
  document.body.insertAdjacentHTML("beforeend", '<div data-load-more="component" data-load-more-initial-count="1"><div data-load-more="item">X</div><div data-load-more="item">Y</div><button data-load-more="trigger">More</button></div>');
  vi.stubGlobal("gsap", void 0);
  a.initAccordions();
  m.initLoadMore();
  f.initFaq();
  const [faq, other] = document.querySelectorAll('[data-load-more="component"]');
  expect(faq.dataset.faqStartupState).toBe("fallback");
  expect(faq.querySelectorAll("[hidden]")).toHaveLength(0);
  expect(other.dataset.loadMoreReady).toBe("true");
  vi.stubGlobal("gsap", fakeGsap());
  a.initAccordions();
  expect(faq.querySelector("[data-accordion-ready]")).toBeNull();
});
it("rolls back all related modules after a working accordion runtime failure", () => {
  a.initAccordions();
  m.initLoadMore();
  f.initFaq();
  const root = document.querySelector("section"), record = a.getAccordionInstances()[0].items[0];
  record.timeline.invalidate = () => {
    throw Error("runtime");
  };
  record.trigger.click();
  expect(root.dataset.faqStartupState).toBe("fallback");
  expect(root.querySelector('[data-faq-split="source"]')).not.toBeNull();
  expect(root.querySelectorAll("[hidden],[inert],[data-accordion-ready]")).toHaveLength(0);
  f.initFaq();
  expect(root.querySelector('[data-faq-split="source"]')).not.toBeNull();
});
it("rolls back if synchronous first setup crosses deadline before commit", () => {
  const original = gsap.set;
  gsap.set = (el, v) => {
    original(el, v);
    clock = 4001;
  };
  a.initAccordions();
  const root = document.querySelector("section");
  expect(root.dataset.faqStartupState).toBe("fallback");
  expect(root.querySelectorAll("[data-accordion-ready],[inert]")).toHaveLength(0);
  expect(root.querySelector('[data-accordion="content"]').style.height).toBe("");
});
it("marks inactive footer managed and permits its first later activation after expiry", () => {
  document.body.innerHTML = '<section data-accordion="component" data-accordion-breakpoints="mbp"><div data-accordion="item"><button data-accordion="trigger">Footer</button><div data-accordion="content"><a href="#x">Link</a></div></div></section>';
  let active = false;
  vi.stubGlobal("matchMedia", () => ({ get matches() {
    return active;
  }, addEventListener() {
  }, removeEventListener() {
  } }));
  const instance = a.initAccordions()[0], item = document.querySelector('[data-accordion="item"]');
  expect(item.dataset.accordionStartupState).toBe("managed");
  clock = 5e3;
  window.sr.componentStartup.fallback();
  active = true;
  instance.evaluateBreakpointState();
  expect(item.dataset.accordionReady).toBe("true");
});
it("restores all questions/source on partial Load more or layout failure and remains terminal", () => {
  a.initAccordions();
  m.initLoadMore();
  const root = document.querySelector("section"), target = root.querySelector('[data-faq-split="target-2"]');
  vi.spyOn(target, "appendChild").mockImplementationOnce(() => {
    throw Error("split");
  });
  f.initFaq();
  expect(root.dataset.faqStartupState).toBe("fallback");
  expect(root.querySelectorAll("[hidden],[inert],[data-accordion-ready]")).toHaveLength(0);
  f.initFaq();
  expect(root.querySelector('[data-faq-split="source"]')).not.toBeNull();
});
it("does not recollapse later records after a first activation failure destroys the FAQ", () => {
  const original = gsap.set;
  let fail = true;
  gsap.set = (el, v) => {
    original(el, v);
    if (fail) {
      fail = false;
      throw Error("activation");
    }
  };
  a.initAccordions();
  const root = document.querySelector("section");
  expect(root.dataset.faqStartupState).toBe("fallback");
  expect([...root.querySelectorAll('[data-accordion="content"]')].every((el) => el.style.height === "")).toBe(true);
});
it("keeps malformed FAQ markup terminal with no Load more restrictions", () => {
  document.querySelector('[data-accordion="trigger"]').remove();
  a.initAccordions();
  m.initLoadMore();
  f.initFaq();
  const root = document.querySelector("section");
  expect(root.dataset.faqStartupState).toBe("fallback");
  expect(root.querySelectorAll("[hidden],[inert],[data-accordion-ready]")).toHaveLength(0);
  expect(root.querySelector('[data-faq-split="source"]')).not.toBeNull();
});
it("preserves an independently managed nested accordion when the outer FAQ fails", () => {
  const content = document.querySelector('[data-accordion="content"]');
  content.insertAdjacentHTML("beforeend", '<div data-accordion="component" id="nested"><div data-accordion="item"><button data-accordion="trigger">Nested</button><div data-accordion="content">Nested answer</div></div></div>');
  const nested = document.querySelector("#nested");
  a.initAccordions(nested);
  const nestedItem = nested.querySelector('[data-accordion="item"]');
  const original = gsap.set;
  let fail = true;
  gsap.set = (el, v) => {
    original(el, v);
    if (fail) {
      fail = false;
      throw Error("outer failure");
    }
  };
  a.initAccordions(document.querySelector("section"));
  expect(document.querySelector("section").dataset.faqStartupState).toBe("fallback");
  expect(nestedItem.dataset.accordionStartupState).toBe("managed");
  expect(nestedItem.dataset.accordionReady).toBe("true");
  nested.querySelector("button").click();
  expect(nested.querySelector('[data-accordion="content"]').getAttribute("aria-hidden")).toBe("false");
});
it("does not gate an unrelated Load more widget nested inside a FAQ answer", () => {
  document.querySelector('[data-accordion="content"]').insertAdjacentHTML("beforeend", '<div data-load-more="component" id="unrelated" data-load-more-initial-count="1"><div data-load-more="item">X</div><div data-load-more="item">Y</div><button data-load-more="trigger">More</button></div>');
  clock = 5e3;
  m.initLoadMore(document.querySelector("#unrelated"));
  expect(document.querySelector("#unrelated").dataset.loadMoreReady).toBe("true");
});
it("cannot commit a split while intended accordion items were never prepared", () => {
  m.initLoadMore();
  f.initFaq();
  const root = document.querySelector("section");
  expect(root.dataset.faqStartupState).toBe("fallback");
  expect(root.querySelector('[data-faq-split="source"]')).not.toBeNull();
  expect(root.querySelectorAll("[hidden],[inert]")).toHaveLength(0);
});
it("leaves a managed parent operational when a new standalone question arrives after expiry", () => {
  document.body.innerHTML = markup().replace(' data-accordion="component"', "");
  a.initAccordions();
  m.initLoadMore();
  f.initFaq();
  const root = document.querySelector("section"), target = root.querySelector('[data-faq-split="target-1"]');
  target.insertAdjacentHTML("beforeend", '<article data-accordion="item" data-faq-split="item" data-load-more="item" id="late"><button data-accordion="trigger">Late</button><div data-accordion="content">Late answer</div></article>');
  clock = 5e3;
  window.sr.componentStartup.fallback();
  a.initAccordions(document.querySelector("#late"));
  expect(root.dataset.faqStartupState).toBe("managed");
  expect(root.querySelectorAll("[data-accordion-ready]")).toHaveLength(5);
  expect(document.querySelector("#late").dataset.accordionStartupState).toBe("fallback");
});
it("does not claim managed when the configured FAQ Load more trigger is missing", () => {
  document.querySelector('[data-load-more="trigger"]').remove();
  a.initAccordions();
  m.initLoadMore();
  f.initFaq();
  expect(document.querySelector("section").dataset.faqStartupState).toBe("fallback");
  expect(document.querySelectorAll("[data-accordion-ready],[hidden],[inert]")).toHaveLength(0);
});
it("keeps focused question control on the first desktop split", () => {
  a.initAccordions();
  m.initLoadMore();
  const trigger = document.querySelector("button");
  trigger.focus();
  f.initFaq();
  expect(document.activeElement).toBe(trigger);
});
it("reregisters a partially rebuilt FAQ before deadline and rolls it back at expiry", () => {
  a.initAccordions();
  m.initLoadMore();
  f.initFaq();
  f.destroyFaq();
  a.destroyAccordions();
  m.destroyLoadMore();
  a.initAccordions();
  expect(callbacks.size).toBeGreaterThan(0);
  clock = 5e3;
  window.sr.componentStartup.fallback();
  const root = document.querySelector("section");
  expect(root.dataset.faqStartupState).toBe("fallback");
  expect(root.querySelectorAll("[data-accordion-ready],[hidden],[inert]")).toHaveLength(0);
});
it("excludes a standalone nested FAQ question from an outer accordion component", () => {
  document.body.innerHTML = '<section data-accordion="component" id="outer"><article data-accordion="item"><button data-accordion="trigger">Outer</button><div data-accordion="content">Outer' + markup(2).replace(' data-accordion="component"', "") + "</div></article></section>";
  const inner = document.querySelector('[data-faq-split="component"]');
  a.initAccordions(inner);
  m.initLoadMore(inner);
  f.initFaq();
  const innerItem = inner.querySelector('[data-accordion="item"]');
  const outer = a.initAccordions(document.querySelector("#outer"))[0];
  outer.items[0].timeline.invalidate = () => {
    throw Error("outer runtime");
  };
  outer.items[0].trigger.click();
  expect(inner.dataset.faqStartupState).toBe("managed");
  expect(innerItem.dataset.accordionReady).toBe("true");
});
it("preserves a managed standalone nested item and its registered handler on outer fallback", () => {
  const content = document.querySelector('[data-accordion="content"]');
  content.insertAdjacentHTML("beforeend", '<div data-accordion="item" id="independent"><button data-accordion="trigger">Independent</button><div data-accordion="content">Independent answer</div></div>');
  const nested = document.querySelector("#independent");
  a.initAccordions(nested);
  a.initAccordions(document.querySelector("section"));
  m.initLoadMore();
  f.initFaq();
  const outer = a.getAccordionInstances().find((i) => i.root === document.querySelector("section"));
  outer.items[0].timeline.invalidate = () => {
    throw Error("outer runtime");
  };
  outer.items[0].trigger.click();
  expect(nested.dataset.accordionStartupState).toBe("managed");
  expect(nested.dataset.accordionReady).toBe("true");
  nested.querySelector("button").click();
  expect(nested.querySelector('[data-accordion="content"]').getAttribute("aria-hidden")).toBe("false");
});
it.each([1e3, 5e3])("waits for complete DOM markup before FAQ preparation at clock %s", (time) => {
  const descriptor = Object.getOwnPropertyDescriptor(document, "readyState");
  Object.defineProperty(document, "readyState", { configurable: true, value: "loading" });
  try {
    const root = document.querySelector("section"), source = root.firstElementChild;
    a.initAccordions();
    m.initLoadMore();
    f.initFaq();
    expect(root.querySelectorAll("[data-accordion-ready],[hidden],[inert]")).toHaveLength(0);
    expect(root.querySelector('[data-faq-split="source"]')).toBe(source);
    source.insertAdjacentHTML("beforeend", '<article data-accordion="item" data-faq-split="item" data-load-more="item"><button data-accordion="trigger">Late parse</button><div data-accordion="content">Late answer</div></article>');
    clock = time;
    Object.defineProperty(document, "readyState", { configurable: true, value: "interactive" });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(root.querySelectorAll('[data-faq-split="item"]')).toHaveLength(6);
    expect(root.dataset.faqStartupState).toBe(time < 4e3 ? "managed" : "fallback");
    if (time >= 4e3) expect(root.querySelectorAll("[data-accordion-ready],[hidden],[inert]")).toHaveLength(0);
  } finally {
    if (descriptor) Object.defineProperty(document, "readyState", descriptor);
    else delete document.readyState;
  }
});
