import { beforeEach, afterEach, expect, it, vi } from "vitest";
let width, queries, initFaq, initLoadMore, destroyLoadMore, destroyFaq;
function resize(next) {
  width = next;
  for (const mq of queries.values()) {
    const matches = mq.test();
    if (mq.matches !== matches) {
      mq.matches = matches;
      mq.listeners.forEach((fn) => fn({ matches }));
    }
  }
}
function markup(count = 13, breakpoints = "") {
  return `<section data-faq-split="component" data-load-more="component" data-load-more-breakpoints="${breakpoints}" data-load-more-initial-count="8" data-load-more-count="4">
 <div data-faq-split="source" data-load-more="list">${Array.from({ length: count }, (_, i) => `<div data-faq-split="item" data-load-more="item">${i + 1}</div>`).join("")}</div>
 <div class="faq_list-split-wrap"><div data-faq-split="target-1"></div><div data-faq-split="target-2"></div></div>
 <button data-load-more="trigger">More</button></section>`;
}
function numbers(root, target, visible = true) {
  return [...root.querySelector(`[data-faq-split="${target}"]`).children].filter((el) => !visible || !el.hidden).map((el) => Number(el.textContent));
}
beforeEach(async () => {
  vi.resetModules();
  width = 1200;
  queries = /* @__PURE__ */ new Map();
  vi.stubGlobal("matchMedia", (query) => {
    if (!queries.has(query)) {
      const min = Number(query.match(/min-width: (\d+)/)?.[1] || 0);
      const max = Number(query.match(/max-width: (\d+)/)?.[1] || Infinity);
      const mq = { test: () => width >= min && width <= max, listeners: /* @__PURE__ */ new Set(), addEventListener: (_, fn) => mq.listeners.add(fn), removeEventListener: (_, fn) => mq.listeners.delete(fn) };
      mq.matches = mq.test();
      queries.set(query, mq);
    }
    return queries.get(query);
  });
  ({ initFaq, destroyFaq } = await import("../faq.js"));
  ({ initLoadMore, destroyLoadMore } = await import("../load-more.js"));
  document.documentElement.classList.add("sr-page-loaded");
  document.body.innerHTML = markup();
});
afterEach(() => {
  destroyFaq?.();
  destroyLoadMore();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
it("splits initially hidden FAQs evenly and reveals two per column per click", () => {
  initLoadMore();
  initFaq();
  const root = document.querySelector("section");
  expect(numbers(root, "target-1")).toEqual([1, 3, 5, 7]);
  expect(numbers(root, "target-2")).toEqual([2, 4, 6, 8]);
  root.querySelector("button").click();
  expect(numbers(root, "target-1")).toEqual([1, 3, 5, 7, 9, 11]);
  expect(numbers(root, "target-2")).toEqual([2, 4, 6, 8, 10, 12]);
  root.querySelector("button").click();
  expect(numbers(root, "target-1")).toEqual([1, 3, 5, 7, 9, 11, 13]);
  expect(root.querySelector("button").style.display).toBe("none");
});
it("restores mobile order and retains revealed items through repeated resizing", () => {
  initLoadMore();
  initFaq();
  const root = document.querySelector("section");
  root.querySelector("button").click();
  resize(600);
  expect(numbers(root, "source")).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  expect(root.querySelector(".faq_list-split-wrap").style.display).toBe("none");
  resize(1200);
  resize(600);
  expect(numbers(root, "source", false)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
  resize(1200);
  expect(numbers(root, "target-2")).toEqual([2, 4, 6, 8, 10, 12]);
  expect(root.querySelector(".faq_list-split-wrap").style.display).toBe("");
});
it("handles mobile-first, breakpoint-restricted loading and multiple components", () => {
  width = 600;
  document.body.innerHTML = markup(13, "dsk") + markup(5, "dsk");
  initLoadMore();
  initFaq();
  initFaq();
  const [first, second] = document.querySelectorAll("section");
  expect(numbers(first, "source")).toHaveLength(13);
  resize(1200);
  expect(numbers(first, "target-1")).toEqual([1, 3, 5, 7]);
  expect(numbers(second, "target-2")).toEqual([2, 4]);
  resize(600);
  expect(numbers(first, "source")).toHaveLength(13);
});
it("marks completed layouts and restores original source and node identities on destroy", () => {
  const root = document.querySelector("section"), source = root.querySelector('[data-faq-split="source"]'), nodes = [...source.children];
  initFaq();
  expect(root.dataset.faqSplitState).toBe("desktop");
  resize(767);
  expect(root.dataset.faqSplitState).toBe("mobile");
  resize(768);
  expect(root.dataset.faqSplitState).toBe("desktop");
  destroyFaq();
  expect(root.hasAttribute("data-faq-split-state")).toBe(false);
  expect(root.querySelector('[data-faq-split="source"]')).toBe(source);
  expect([...source.children]).toEqual(nodes);
  expect(root.querySelector('[data-faq-split="target-1"]').children).toHaveLength(0);
});
it.each(["initial", "media", "load"])("restores a failed %s layout without preventing a sibling split", (when) => {
  document.body.innerHTML = markup() + markup(5);
  const [root, sibling] = document.querySelectorAll("section");
  const source = root.querySelector('[data-faq-split="source"]'), nodes = [...source.children];
  if (when === "media") {
    resize(600);
    initFaq();
  }
  if (when === "load") document.documentElement.classList.remove("sr-page-loaded");
  const target = root.querySelector('[data-faq-split="target-2"]');
  vi.spyOn(target, "appendChild").mockImplementationOnce(() => {
    throw Error("column failure");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {
  });
  if (when === "media") resize(1200);
  else {
    initFaq();
    if (when === "load") window.dispatchEvent(new Event("load"));
  }
  expect(root.querySelector('[data-faq-split="source"]')).toBe(source);
  expect([...source.children]).toEqual(nodes);
  expect(root.hasAttribute("data-faq-split-state")).toBe(false);
  expect(root.querySelector('[data-faq-split="target-1"]').children).toHaveLength(0);
  expect(sibling.dataset.faqSplitState).toBe("desktop");
});
it("cancels pending load work on destroy", () => {
  document.documentElement.classList.remove("sr-page-loaded");
  initFaq();
  destroyFaq();
  window.dispatchEvent(new Event("load"));
  expect(document.querySelector('[data-faq-split="source"]')).not.toBeNull();
  expect(document.querySelector("[data-faq-split-state]")).toBeNull();
});
it("reveals delivered Load more items and clears its marker and instance on destroy", () => {
  initLoadMore();
  const root = document.querySelector("section");
  expect(root.dataset.loadMoreReady).toBe("true");
  expect(root.querySelectorAll("[hidden]")).toHaveLength(5);
  destroyLoadMore();
  expect(root.querySelectorAll("[hidden], [inert]")).toHaveLength(0);
  expect(root.hasAttribute("data-load-more-ready")).toBe(false);
  expect(root._loadMoreInstance).toBeNull();
  expect(root.querySelector("button").style.display).toBe("none");
});
it("reveals partial Load more mutations when setup fails and continues siblings", () => {
  document.body.innerHTML = markup() + markup(5);
  const root = document.querySelector("section"), item = root.querySelectorAll('[data-load-more="item"]')[10];
  const set = item.style.setProperty.bind(item.style);
  vi.spyOn(item.style, "display", "set").mockImplementationOnce(() => {
    set("display", "none");
    throw Error("visibility failure");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {
  });
  expect(() => initLoadMore()).not.toThrow();
  expect(root.querySelectorAll("[hidden], [inert]")).toHaveLength(0);
  expect([...root.querySelectorAll('[data-load-more="item"]')].every((el) => el.style.display !== "none")).toBe(true);
  expect(root.hasAttribute("data-load-more-ready")).toBe(false);
  expect(root.querySelector("button").style.display).toBe("none");
  expect(document.querySelectorAll("section")[1].dataset.loadMoreReady).toBe("true");
});
it("falls back after a Load more click error and removes the listener", () => {
  initLoadMore();
  const root = document.querySelector("section"), item = root.querySelector('[data-load-more="item"]');
  vi.spyOn(item.style, "display", "set").mockImplementationOnce(() => {
    throw Error("click failure");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {
  });
  root.querySelector("button").click();
  expect(root.querySelectorAll("[hidden], [inert]")).toHaveLength(0);
  expect(root.hasAttribute("data-load-more-ready")).toBe(false);
  expect(root._loadMoreInstance).toBeNull();
  root.querySelector("button").click();
  expect(root.querySelectorAll("[hidden]")).toHaveLength(0);
});
it("deactivates mobile Load more with readable links and reactivates original counts", () => {
  document.body.innerHTML = markup(13, "mbl, mbp");
  resize(479);
  initLoadMore();
  const root = document.querySelector("section");
  expect(root.dataset.loadMoreReady).toBe("true");
  resize(480);
  expect(root.querySelectorAll("[hidden]")).toHaveLength(5);
  resize(768);
  expect(root.hasAttribute("data-load-more-ready")).toBe(false);
  expect(root.querySelectorAll("[hidden], [inert]")).toHaveLength(0);
  resize(767);
  expect(root.dataset.loadMoreReady).toBe("true");
  expect(root.querySelectorAll("[hidden]")).toHaveLength(5);
});
it("restores CMS wrapper structure as well as item order after splitting and failure", () => {
  const root = document.querySelector("section"), source = root.querySelector('[data-faq-split="source"]');
  source.innerHTML = '<div class="w-dyn-list"><div class="w-dyn-items"><div class="w-dyn-item"><article data-faq-split="item">Q1<a href="#a">A1</a></article></div><div class="w-dyn-item"><article data-faq-split="item">Q2<a href="#b">A2</a></article></div></div></div>';
  const html = source.innerHTML, nodes = [...source.querySelectorAll("article")];
  initFaq();
  resize(600);
  expect(source.innerHTML).toBe(html);
  expect([...source.querySelectorAll("article")]).toEqual(nodes);
  resize(1200);
  destroyFaq();
  expect(source.innerHTML).toBe(html);
});
it("isolates nested Load more controls and preserves authored item styling on cleanup", () => {
  document.body.innerHTML = '<section data-load-more="component" id="outer"><section data-load-more="component" data-load-more-initial-count="1"><div data-load-more="item" style="display:grid;color:red">One</div><div data-load-more="item" style="display:flex">Two</div><button data-load-more="trigger">More</button></section></section>';
  initLoadMore();
  expect(document.querySelector("#outer")._loadMoreInstance).toBeUndefined();
  destroyLoadMore();
  expect(document.querySelector('[data-load-more="item"]').style.display).toBe("grid");
  expect(document.querySelector('[data-load-more="item"]').style.color).toBe("red");
});
it.each(["destroy", "failure"])("keeps desktop columns visible after %s and retry", (when) => {
  const root = document.querySelector("section"), wrapper = root.querySelector(".faq_list-split-wrap");
  if (when === "destroy") {
    initFaq();
    destroyFaq();
  } else {
    vi.spyOn(root.querySelector('[data-faq-split="target-2"]'), "appendChild").mockImplementationOnce(() => {
      throw Error("split failed");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {
    });
    initFaq();
  }
  initFaq();
  expect(root.dataset.faqSplitState).toBe("desktop");
  expect(wrapper.style.display).not.toBe("none");
  expect(root.querySelectorAll('[data-faq-split="target-1"] > *')).toHaveLength(7);
});
it("preserves focused source links on initial mobile layout and breakpoint reparenting", () => {
  resize(600);
  const root = document.querySelector("section"), item = root.querySelector('[data-faq-split="item"]');
  item.innerHTML = '<a href="#x">Answer link</a>';
  const link = item.querySelector("a");
  link.focus();
  initFaq();
  expect(document.activeElement).toBe(link);
  resize(1200);
  expect(document.activeElement).toBe(link);
  resize(600);
  expect(document.activeElement).toBe(link);
  destroyFaq();
  expect(document.activeElement).toBe(link);
});
it("does not let a stale destroyed Load more instance erase its replacement", () => {
  initLoadMore();
  const root = document.querySelector("section"), old = root._loadMoreInstance;
  old.destroy();
  initLoadMore();
  const current = root._loadMoreInstance;
  old.destroy();
  old.evaluateBreakpointState();
  expect(root._loadMoreInstance).toBe(current);
  expect(root.dataset.loadMoreReady).toBe("true");
  root.querySelector("button").click();
  expect(root.querySelectorAll("[hidden]")).toHaveLength(1);
});
it("returns no dead Load more instance after initial visibility failure", () => {
  const root = document.querySelector("section"), item = root.querySelector('[data-load-more="item"]');
  vi.spyOn(item.style, "display", "set").mockImplementationOnce(() => {
    throw Error("setup failed");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {
  });
  expect(initLoadMore()).toEqual([]);
  expect(root._loadMoreInstance).toBeNull();
});
