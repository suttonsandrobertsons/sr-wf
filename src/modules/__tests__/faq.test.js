import { beforeEach, afterEach, expect, it, vi } from "vitest";

let width, queries, initFaq, initLoadMore, destroyLoadMore;
function resize(next) {
 width = next;
 for (const mq of queries.values()) {
  const matches = mq.test();
  if (mq.matches !== matches) {
   mq.matches = matches;
   mq.listeners.forEach(fn => fn({ matches }));
  }
 }
}
function markup(count = 13, breakpoints = "") {
 return `<section data-faq-split="component" data-load-more="component" data-load-more-breakpoints="${breakpoints}" data-load-more-initial-count="8" data-load-more-count="4">
 <div data-faq-split="source" data-load-more="list">${Array.from({length:count}, (_, i) => `<div data-faq-split="item" data-load-more="item">${i+1}</div>`).join("")}</div>
 <div class="faq_list-split-wrap"><div data-faq-split="target-1"></div><div data-faq-split="target-2"></div></div>
 <button data-load-more="trigger">More</button></section>`;
}
function numbers(root, target, visible = true) {
 return [...root.querySelector(`[data-faq-split="${target}"]`).children]
 .filter(el => !visible || !el.hidden).map(el => Number(el.textContent));
}
beforeEach(async () => {
 vi.resetModules(); width = 1200; queries = new Map();
 vi.stubGlobal("matchMedia", query => {
  if (!queries.has(query)) {
   const min = Number(query.match(/min-width: (\d+)/)?.[1] || 0);
   const max = Number(query.match(/max-width: (\d+)/)?.[1] || Infinity);
   const mq = {test: () => width >= min && width <= max, listeners: new Set(), addEventListener: (_, fn) => mq.listeners.add(fn), removeEventListener: (_, fn) => mq.listeners.delete(fn)};
   mq.matches = mq.test(); queries.set(query, mq);
  }
  return queries.get(query);
 });
 ({initFaq} = await import('../faq.js'));
 ({initLoadMore, destroyLoadMore} = await import('../load-more.js'));
 document.documentElement.classList.add('sr-page-loaded');
 document.body.innerHTML = markup();
});
afterEach(() => { destroyLoadMore(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
it('splits initially hidden FAQs evenly and reveals two per column per click', () => {
 initLoadMore(); initFaq();
 const root = document.querySelector('section');
 expect(numbers(root, 'target-1')).toEqual([1,3,5,7]);
 expect(numbers(root, 'target-2')).toEqual([2,4,6,8]);
 root.querySelector('button').click();
 expect(numbers(root, 'target-1')).toEqual([1,3,5,7,9,11]);
 expect(numbers(root, 'target-2')).toEqual([2,4,6,8,10,12]);
 root.querySelector('button').click();
 expect(numbers(root, 'target-1')).toEqual([1,3,5,7,9,11,13]);
 expect(root.querySelector('button').style.display).toBe('none');
});
it('restores mobile order and retains revealed items through repeated resizing', () => {
 initLoadMore(); initFaq();
 const root = document.querySelector('section');
 root.querySelector('button').click();
 resize(600);
 expect(numbers(root, 'source')).toEqual(Array.from({length:12}, (_,i) => i+1));
 expect(root.querySelector('.faq_list-split-wrap').style.display).toBe('none');
 resize(1200); resize(600);
 expect(numbers(root, 'source', false)).toEqual(Array.from({length:13}, (_,i) => i+1));
 resize(1200);
 expect(numbers(root, 'target-2')).toEqual([2,4,6,8,10,12]);
 expect(root.querySelector('.faq_list-split-wrap').style.display).toBe('');
});
it('handles mobile-first, breakpoint-restricted loading and multiple components', () => {
 width = 600; document.body.innerHTML = markup(13, 'dsk') + markup(5, 'dsk');
 initLoadMore(); initFaq(); initFaq();
 const [first, second] = document.querySelectorAll('section');
 expect(numbers(first, 'source')).toHaveLength(13);
 resize(1200);
 expect(numbers(first, 'target-1')).toEqual([1,3,5,7]);
 expect(numbers(second, 'target-2')).toEqual([2,4]);
 resize(600);
 expect(numbers(first, 'source')).toHaveLength(13);
});
