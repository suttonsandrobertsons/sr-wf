import { beforeEach, afterEach, expect, it, vi } from "vitest";
const modules = {
  copyright: ["initCopyrightYear"],
  accordions: ["initAccordions"],
  nav: ["initNav"],
  "carousels/splide": ["initCarousels", "destroyCarousels", "reInitCarousels", "getCarouselInstances"],
  "overflow-drag": ["initOverflowDrag"],
  "forms/index": ["initForms", "destroySelects"],
  "forms/quote-sheet": ["initQuoteSheet"],
  process: ["initProcess"],
  "section-nav": ["initSectionNav"],
  tabs: ["initTabs"],
  "load-more": ["initLoadMore"],
  tables: ["initTables"],
  faq: ["initFaq"],
  "gold-trend": ["initGoldTrend"],
  "history-timeline": ["initHistoryTimeline"],
  map: ["initMaps"],
  "all-resources-filters": ["initAllResourcesFilters", "getAllResourcesFiltersInstance"],
  "contact-widget": ["initContactWidget", "getContactWidgetInstances"],
  "a11y-anchors": ["initA11yAnchors"]
};
let calls;
beforeEach(() => {
  vi.resetModules();
  calls = [];
  window.sr = { env: { src: "local-test" }, functions: { custom: 123 } };
  vi.spyOn(console, "warn").mockImplementation(() => {
  });
  document.documentElement.classList.add("sr-page-loaded");
  document.documentElement.classList.remove("sr-ready");
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const path of Object.keys(modules)) vi.doUnmock(`../${path}.js`);
  delete window.sr;
});
it.each(["initTabs", "initCarousels", "initAccordions", "initLoadMore", "initFaq"])("continues sequential startup after %s fails and retains globals", async (failing) => {
  for (const [path, names] of Object.entries(modules)) vi.doMock(`../${path}.js`, () => Object.fromEntries(names.map((name) => [name, () => {
    calls.push(name);
    if (name === failing) throw Error("failed enhancement");
  }])));
  await expect(import("../../../loader.js")).resolves.toBeDefined();
  expect(calls).toEqual(["initNav", "initSectionNav", "initForms", "initTabs", "initOverflowDrag", "initCarousels", "initAccordions", "initLoadMore", "initTables", "initFaq", "initGoldTrend", "initQuoteSheet", "initAllResourcesFilters", "initHistoryTimeline", "initContactWidget", "initProcess", "initCopyrightYear", "initA11yAnchors"]);
  expect(window.sr.env.src).toBe("local-test");
  expect(window.sr.functions.custom).toBe(123);
  expect(document.documentElement.classList.contains("sr-ready")).toBe(true);
  expect(document.documentElement.classList.contains("sr-page-loaded")).toBe(true);
});
