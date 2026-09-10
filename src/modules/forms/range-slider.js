import { formConfig } from "./config.js";
import { parseNumber } from "./numbers.js";

const SELECTORS = {
  slider: "[data-form-loan-slider]",
  amount: "[data-form-loan-amount]",
  fill: ".form-loan_slider-fill",
  thumb: ".form-loan_slider-thumb",
};

// Default loan amount shown before the customer interacts with the slider.
const DEFAULT_AMOUNT = 5000;

function init(sliderTrack) {
  const form = sliderTrack.closest("[data-form-loan]");
  if (!form) return;

  const cfg = formConfig.loan;
  const min = cfg.min;
  const max = cfg.max;
  const step = cfg.step;

  const fill = sliderTrack.querySelector(SELECTORS.fill);
  const thumb = sliderTrack.querySelector(SELECTORS.thumb);
  const amountEl = form.querySelector(SELECTORS.amount);

  if (!fill || !thumb || !amountEl) return;

  let current = snap(readAmount(amountEl, DEFAULT_AMOUNT));

  thumb.setAttribute("tabindex", "0");
  thumb.setAttribute("role", "slider");
  thumb.setAttribute("aria-valuemin", String(min));
  thumb.setAttribute("aria-valuemax", String(max));
  thumb.setAttribute("aria-valuenow", String(current));
  thumb.setAttribute("aria-label", "Loan amount");

  updateDisplay(current);
  thumb.addEventListener("keydown", (e) => handleKey(e, current));

  let dragging = false;

  function snap(value) {
    let v = Math.round(value / step) * step;
    if (v < min) v = min;
    if (v > max) v = max;
    return v;
  }

  function readAmount(el, fallback) {
    const text = (el.textContent || "").replace(/[^0-9.]/g, "");
    const val = parseNumber(text);
    return Number.isFinite(val) && val >= min ? val : fallback;
  }

  function updateDisplay(value) {
    const span = max - min;
    const pct = span > 0 ? ((value - min) / span) * 100 : 0;
    fill.style.width = pct + "%";
    thumb.style.left = pct + "%";
    thumb.setAttribute("aria-valuenow", String(value));
    amountEl.textContent = "£" + value.toLocaleString("en-GB");
  }

  function setValue(value) {
    current = snap(value);
    updateDisplay(current);
    amountEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function getPosition(clientX) {
    const rect = sliderTrack.getBoundingClientRect();
    const pct = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
    return min + pct * (max - min);
  }

  function handleKey(e, value) {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); setValue(value + step); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); setValue(value - step); }
    else if (e.key === "Home") { e.preventDefault(); setValue(min); }
    else if (e.key === "End") { e.preventDefault(); setValue(max); }
  }

  function onStart(clientX) {
    if (dragging) return;
    dragging = true;
    thumb.focus();
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    onMove(clientX);
  }

  function onMove(clientX) {
    if (!dragging) return;
    setValue(getPosition(clientX));
  }

  function onEnd() {
    dragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onEnd);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onEnd);
  }

  thumb.addEventListener("mousedown", (e) => { e.preventDefault(); onStart(e.clientX); });
  sliderTrack.addEventListener("mousedown", (e) => {
    if (e.target === thumb) return;
    onStart(e.clientX);
  });
  const onMouseMove = (e) => onMove(e.clientX);

  thumb.addEventListener("touchstart", (e) => { e.preventDefault(); onStart(e.touches[0].clientX); });
  sliderTrack.addEventListener("touchstart", (e) => {
    if (e.target === thumb) return;
    onStart(e.touches[0].clientX);
  });
  const onTouchMove = (e) => { e.preventDefault(); onMove(e.touches[0].clientX); };

  // Syncs from the amount input when the customer types directly.
  amountEl.addEventListener("input", () => {
    if (dragging) return;
    const val = readAmount(amountEl, current);
    if (val !== current) {
      current = snap(val);
      updateDisplay(current);
    }
  });

  // Exposes setValue on the thumb for programmatic access (DevTools, testing).
  thumb._setSliderValue = setValue;
  thumb._getSliderValue = () => current;
}

export function initRangeSliders(scope = document) {
  const sliders = [
    ...(scope.matches?.(SELECTORS.slider) ? [scope] : []),
    ...scope.querySelectorAll(SELECTORS.slider),
  ];
  sliders.forEach(init);
}
