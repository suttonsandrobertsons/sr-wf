// Parsing, rounding and formatting for money and quantities.
//
// Renamed from shared.js on 9 Sep 2026: there were two files called
// shared.js in this tree, and this one has a specific job.

export function parseNumber(value) {
  let clean = String(value ?? "").replace(/[^0-9.-]/g, "");
  // Collapses multiple dots (e.g. stray thousands separators in "1.234.56"):
  // keeps the first dot as the decimal point, drops any later ones.
  const firstDot = clean.indexOf(".");
  if (firstDot !== -1) {
    clean = clean.slice(0, firstDot + 1) + clean.slice(firstDot + 1).replace(/\./g, "");
  }
  if (!clean || clean === "-" || clean === "." || clean === "-.") return NaN;
  return Number(clean);
}

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function formatMoney(value, currency = "GBP", fractionDigits = 0) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: fractionDigits,
  }).format(Number(value) || 0);
}

export function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(Number(value) || 0);
}

export function getRateBand(amount, bands) {
  for (const band of bands) {
    const hasInclusive = Number.isFinite(band?.maxInclusive);
    const hasExclusive = Number.isFinite(band?.maxExclusive);
    // Skips malformed bands that declare no usable upper bound, rather than
    // silently evaluating `amount < undefined` (always false) and falling through.
    if (!hasInclusive && !hasExclusive) continue;
    if (hasInclusive && amount <= band.maxInclusive) return band;
    if (hasExclusive && amount < band.maxExclusive) return band;
  }
  return null;
}
