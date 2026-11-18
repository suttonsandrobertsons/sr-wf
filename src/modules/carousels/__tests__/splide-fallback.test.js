import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCarousel, initCarousels, destroyCarousels, getCarouselInstances } from "../splide.js";

// The fake models the DOM mutations and synchronous events that make a partial
// Splide mount unsafe. Scroll geometry is checked separately in a real browser.
describe("Splide native fallback lifecycle", () => {
 let phase, created, media, listeners;
 const markup = (id = "slider") => `<div class="splide authored" id="${id}" aria-label="Recent buys" style="color: red; max-width: 90%">
 <div class="splide__track" tabindex="0" aria-label="Recent buys, scroll cards" style="padding-left: 2px"><ul class="splide__list" style="transform: translateX(2px)">
 <li class="splide__slide authored-slide" style="margin-right: 3px" aria-hidden="false"><a href="#card" tabindex="0">One</a><img loading="lazy"></li><li class="splide__slide">Two</li></ul></div>
 <div class="carousel-controls"><div class="carousel-controls_dots"><button type="button">Authored</button></div></div></div>`;
 beforeEach(() => {
  phase = null; created = []; listeners = new Set();
  media = { matches: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  vi.stubGlobal("matchMedia", () => media);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("Splide", class {
   constructor(root) {
    this.root = root; this.events = new Map(); this.Components = { Layout: { isOverflow: () => { if (this.mountingStarted && ["callback", "native-callback"].includes(phase) && root.id === "bad") throw Error("callback failed"); return true; } } }; this.options = {};
    created.push(this);
    root.classList.add("is-initialized"); root.style.maxWidth = "700px";
    if (phase === "constructor" && root.id === "bad") throw Error("constructor failed");
   }
   on(event, callback) { this.events.set(event, callback); }
   emit(event, ...args) {
    const callback = this.events.get(event);
    if (phase === "native-callback" && callback) {
     const target = new EventTarget(); target.addEventListener(event, () => callback(...args)); target.dispatchEvent(new Event(event));
    } else callback?.(...args);
   }
   mount() {
    expect(this.root.dataset.carouselState).toBe("mounting");
    const list = this.root.querySelector(".splide__list");
    list.style.transform = "translateX(-900px)";
    const slide = list.firstElementChild; slide.setAttribute("aria-hidden", "true"); slide.querySelector("a")?.setAttribute("tabindex", "-1");
    const clone = slide.cloneNode(true); clone.classList.add("splide__slide--clone"); list.append(clone);
    const duplicate = slide.cloneNode(true); duplicate.setAttribute("data-marquee-duplicate", ""); list.append(duplicate);
    this.mountingStarted = true;
    this.emit("mounted");
    if (phase === "mount" && this.root.id === "bad") throw Error("mount failed");
    this.emit("ready");
    expect(this.root.dataset.carouselState).toBe("mounting");
   }
   destroy(completely) { this.completely = completely; this.root.removeAttribute("style"); if (phase === "destroy") throw Error("destroy failed"); }
   refresh() { if (phase === "refresh") throw Error("refresh failed"); }
  });
  document.body.innerHTML = markup();
 });
 afterEach(() => { destroyCarousels(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
 it("leaves original content in fallback when Splide is missing", () => {
  vi.stubGlobal("Splide", undefined);
  const root = document.querySelector(".splide"); const before = root.innerHTML;
  expect(createCarousel(root)).toBeNull(); expect(root.dataset.carouselState).toBe("fallback"); expect(root.innerHTML).toBe(before);
 });
 it.each(["track", "list"])("validates its own %s before construction", (part) => {
  document.querySelector(`.splide__${part}`).classList.remove(`splide__${part}`);
  const root = document.querySelector(".splide");
  expect(createCarousel(root)).toBeNull(); expect(created).toHaveLength(0); expect(root.dataset.carouselState).toBe("fallback");
 });
 it("keeps empty tracks readable without constructing a carousel", () => {
  document.querySelector(".splide__list").replaceChildren();
  expect(createCarousel(document.querySelector(".splide"))).toBeNull(); expect(created).toHaveLength(0);
 });
 it("announces ready only after mount returns and reuses the working instance", () => {
  const root = document.querySelector(".splide"); const instance = createCarousel(root);
  expect(root.dataset.carouselState).toBe("ready"); expect(createCarousel(root)).toBe(instance); expect(created).toHaveLength(1);
 });
 it.each(["constructor", "mount", "callback"])("contains a throwing %s and initialises the next root", (failure) => {
  phase = failure; document.body.innerHTML = markup("bad") + markup("good");
  const bad = document.querySelector("#bad"); const original = bad.querySelector(".splide__slide");
  expect(() => initCarousels()).not.toThrow();
  expect(bad.dataset.carouselState).toBe("fallback"); expect(bad.querySelectorAll(".splide__slide")).toHaveLength(2);
  expect(bad.querySelector(".splide__slide")).toBe(original); expect(bad.style.maxWidth).toBe("90%");
  expect(document.querySelector("#good").dataset.carouselState).toBe("ready");
 });
 it("restores original nodes, styles, ARIA and authored pagination on complete destruction", () => {
  const root = document.querySelector(".splide"), slide = root.querySelector(".splide__slide"), button = root.querySelector("button");
  const click = vi.fn(); slide.querySelector("a").addEventListener("click", click);
  const instance = createCarousel(root);
  root.style.backgroundColor = "blue"; root.classList.add("foreign-class");
  instance.destroy(); instance.destroy();
  expect(instance.splide.completely).toBe(true); expect(root.dataset.carouselState).toBe("fallback");
  expect(root.querySelectorAll(".splide__slide")).toHaveLength(2); expect(root.querySelector(".splide__slide")).toBe(slide);
  expect(root.querySelector("button")).toBe(button); expect(slide.getAttribute("aria-hidden")).toBe("false");
  expect(slide.querySelector("a").tabIndex).toBe(0); expect(root.style.maxWidth).toBe("90%"); expect(root.style.color).toBe("red");
  expect(root.style.backgroundColor).toBe("blue"); expect(root.classList.contains("foreign-class")).toBe(true); expect(root.classList.contains("is-initialized")).toBe(false);
  expect(root.querySelector(".splide__list").style.transform).toBe("translateX(2px)"); expect(getCarouselInstances()).not.toContain(instance);
  slide.querySelector("a").click(); expect(click).toHaveBeenCalledOnce();
 });
 it("restores fallback even when library destruction throws", () => {
  const root = document.querySelector(".splide"), instance = createCarousel(root); phase = "destroy";
  expect(() => instance.destroy()).not.toThrow(); expect(root.dataset.carouselState).toBe("fallback"); expect(root.querySelectorAll(".splide__slide")).toHaveLength(2);
 });
 it("recovers from a module callback failing after mount", () => {
  const root = document.querySelector(".splide"), instance = createCarousel(root); phase = "refresh";
  expect(() => instance.reInit()).not.toThrow(); expect(root.dataset.carouselState).toBe("fallback"); expect(root._splideInstance).toBeNull();
 });
 it("cancels pending image work and breakpoint listeners after failure", () => {
  vi.useFakeTimers(); phase = "mount";
  const root = document.querySelector(".splide"); root.id = "bad"; root.dataset.splideAutoscroll = "true"; root.dataset.splideLoopMobile = "true";
  const image = root.querySelector("img"); Object.defineProperty(image, "complete", { value: false });
  expect(createCarousel(root)).toBeNull(); image.dispatchEvent(new Event("load")); vi.runAllTimers();
  expect(vi.getTimerCount()).toBe(0); expect(listeners.size).toBe(0); expect(image.getAttribute("loading")).toBe("lazy");
 });
 it("rebuilds exactly one instance at the mobile breakpoint", () => {
  const root = document.querySelector(".splide"); root.dataset.splideLoopMobile = "true";
  const first = createCarousel(root); media.matches = true; [...listeners].forEach(fn => fn());
  expect(first.splide.completely).toBe(true); expect(root._splideInstance).not.toBe(first); expect(root.dataset.carouselState).toBe("ready");
  expect(listeners.size).toBe(1); expect(getCarouselInstances().filter(i => i.root === root)).toHaveLength(1);
  expect(root.querySelectorAll(".splide__slide:not(.splide__slide--clone):not([data-marquee-duplicate])")).toHaveLength(2);
 });
 it.each(["destroy", "reordered", "breakpoint"])("retains focus on an original card during %s restoration", (operation) => {
  const root = document.querySelector(".splide"); root.dataset.splideLoopMobile = "true";
  const instance = createCarousel(root), list = root.querySelector(".splide__list"), original = list.firstElementChild;
  const link = original.querySelector("a");
  if (operation === "reordered") list.append(original);
  link.focus(); expect(document.activeElement).toBe(link);
  if (operation === "breakpoint") {
   media.matches = true; [...listeners].forEach(fn => fn());
   expect(root._splideInstance).not.toBe(instance); expect(getCarouselInstances().filter(i => i.root === root)).toHaveLength(1);
  } else instance.destroy();
  expect(root.querySelector(".splide__slide")).toBe(original);
  expect(document.activeElement).toBe(link);
 });
 it("does not claim a custom root or borrow a nested root's track", () => {
  document.body.innerHTML = `<div class="splide" id="outer">${markup("child")}</div>`;
  const outer = document.querySelector("#outer"), child = document.querySelector("#child"); child.dataset.splideCustom = "";
  expect(createCarousel(child)).toBeNull(); expect(child.hasAttribute("data-carousel-state")).toBe(false);
  expect(createCarousel(outer)).toBeNull(); expect(created).toHaveLength(0);
 });
 it("does not use slides from a nested carousel as its own source", () => {
  document.body.innerHTML = `<div class="splide" id="outer"><div class="splide__track"><ul class="splide__list"><li>${markup("child")}</li></ul></div></div>`;
  expect(createCarousel(document.querySelector("#outer"))).toBeNull(); expect(created).toHaveLength(0);
 });
 it("preserves a nested ready component and its image loading on parent cleanup", () => {
  const root = document.querySelector(".splide"); root.dataset.splideAutoscroll = "true";
  const nested = document.createElement("div"); nested.className = "splide"; nested.dataset.carouselState = "ready";
  nested.innerHTML = '<img loading="lazy"><a tabindex="2">Nested</a>';
  nested.querySelector("img").loading = "lazy"; // jsdom does not reflect this native property.
  root.querySelector(".splide__slide").append(nested);
  const instance = createCarousel(root);
  expect(nested.querySelector("img").loading).toBe("lazy");
  instance.destroy(); expect(nested.dataset.carouselState).toBe("ready"); expect(nested.querySelector("a").tabIndex).toBe(2);
 });
 it("ignores callbacks retained by the library after destruction", () => {
  const root = document.querySelector(".splide"), instance = createCarousel(root); instance.destroy();
  instance.splide.emit("drag"); instance.splide.emit("mounted");
  expect(root.dataset.carouselState).toBe("fallback"); expect(root.classList.contains("is-dragging")).toBe(false);
 });

 it("records native EventTarget listener failures before declaring ready", () => {
  const preventReportedError = event => event.preventDefault(); window.addEventListener("error", preventReportedError);
  try {
   phase = "native-callback"; document.body.innerHTML = markup("bad") + markup("good");
   initCarousels(); expect(document.querySelector("#bad").dataset.carouselState).toBe("fallback"); expect(document.querySelector("#good").dataset.carouselState).toBe("ready");
  } finally { window.removeEventListener("error", preventReportedError); }
 });
 it("preserves form and content state changed independently while enhanced", () => {
  const root = document.querySelector(".splide"); const content = document.createElement("div");
  content.innerHTML = '<button type="button">Submit</button><p>Conditional content</p>';
  root.querySelector(".splide__slide").append(content); const button = content.querySelector("button"), p = content.querySelector("p");
  const instance = createCarousel(root); button.disabled = true; p.hidden = true; p.style.display = "none"; p.classList.add("is-active");
  instance.destroy(); expect(button.disabled).toBe(true); expect(p.hidden).toBe(true); expect(p.style.display).toBe("none"); expect(p.classList.contains("is-active")).toBe(true);
 });

 it("cleans components and event binders when Splide defers partial-mount destruction", () => {
  const root = document.querySelector(".splide"); let destroyed = false, disposed = false;
  class PartialSplide {
   static STATES = { CREATED: 1, DESTROYED: 7 };
   constructor() {
    this.state = { is: value => value === (destroyed ? 7 : 1), set: value => { destroyed = value === 7; } };
    this.Components = { Media: { destroy: () => { disposed = true; } } };
    this.event = { emit() {}, destroy() {} };
   }
   on() {}
   mount() { throw Error("component mount failed before ready"); }
   destroy() { /* Splide defers this call until ready when still CREATED. */ }
  }
  vi.stubGlobal("Splide", PartialSplide);
  expect(createCarousel(root)).toBeNull(); expect(root.dataset.carouselState).toBe("fallback"); expect(disposed).toBe(true); expect(destroyed).toBe(true);
 });

 it("can destroy its owned instance after the global constructor disappears", () => {
  const root = document.querySelector(".splide"), instance = createCarousel(root); vi.stubGlobal("Splide", undefined);
  expect(() => instance.destroy()).not.toThrow(); expect(root.dataset.carouselState).toBe("fallback");
 });

});
