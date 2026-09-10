// Trailing-edge debounce with a cancel().
//
// nav.js and carousels/splide-press.js each have their own copy. They are
// out of scope for the forms cleanup on 9 Sep 2026, but this is the one to
// converge on.

export function debounce(callback, delay = 120) {
  let timer = 0;
  const debounced = (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
  debounced.cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  return debounced;
}
