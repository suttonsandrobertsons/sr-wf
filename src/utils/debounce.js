// Trailing-edge debounce with a cancel().
//
// nav.js and carousels/splide-press.js have their own copies; prefer this one.

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
