import { formConfig } from "./config.js";
import { formDom, formValues, formLogger, formApp } from "./core.js";
import { initSelects } from "./selects.js";
import {parseNumber, roundMoney, formatMoney, formatNumber, getRateBand} from "./numbers.js";
import { debounce } from "../../utils/debounce.js";
import { escapeSelector } from "../../utils/dom.js";

const SELECTORS = {
  form: "form[data-form-gold]",
  item: "[data-form-gold-item]",
  itemList: "[data-form-gold-item-list]",
  pricingRow: "[data-form-gold-pricing-row]",
  pricingField: "[data-form-gold-pricing-field]",
  output: "[data-form-gold-output]",
  itemOutput: "[data-form-gold-item-output]",
  error: "[data-form-error], .form_field-error",
  itemTitle: "[data-form-gold-item-title]",
  action: "[data-form-gold-action]",
  quantity: "[data-form-gold-quantity]",
  quantityInput: "[data-form-gold-quantity-input]",
  quantityAction: "[data-form-gold-quantity-action]",
  formAction: "[data-form-action]",
  field: "[data-form-field]",
};

const FIELD_NAMES = {
  enquiryType: "enquiry_type",
  itemType: "item_type",
  bullionName: "bullion_name",
  metalType: "metal_type",
  weightGrams: "weight_grams",
  quantity: "quantity",
};

const GOLD_STATUS_STATES = ["loading", "ready", "invalid", "error"];
const GOLD_ITEM_STATES = ["pending", "priced", "manual"];
const MAX_ITEMS = 5;
const initializedForms = new WeakSet();
const instances = new WeakMap();


function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getFieldValue(root, name) {
  return formValues.get(root, name)[0] || "";
}

function getIndexedFieldName(name, index) {
  return index ? `gold_${name}_${index}` : name;
}

function getItemFieldValue(itemElement, name) {
  const itemIndex = itemElement?.getAttribute("data-form-gold-item-index");
  const indexedName = getIndexedFieldName(name, itemIndex);
  const directValue = getFieldValue(itemElement, indexedName) || getFieldValue(itemElement, name);
  if (directValue) return directValue;

  // Prefer the control whose name carries this item's indexed prefix, else
  // any readable control in the field's wrappers. The fallback is needed
  // because prepareChooseOneControls (core/fields.js) renames all but one
  // control sharing a base name (e.g. bullion_name) to `_disabled_<name>`,
  // so items 2+ may not match by indexed name.
  const readableControls = getFieldWrappers(itemElement, name)
    .flatMap((field) => Array.from(field.querySelectorAll("input, select, textarea")))
    .filter((control) => formValues.shouldReadField(control));

  const indexedValues = readableControls
    .filter((control) => control.name?.startsWith(`${indexedName}_`))
    .flatMap((control) => formValues.getControlValues(control))
    .filter((value) => value !== "");
  if (indexedValues.length) return indexedValues[0];

  const branchValues = readableControls
    .flatMap((control) => formValues.getControlValues(control))
    .filter((value) => value !== "");
  return branchValues[0] || "";
}

function getFieldWrappers(root, name) {
  const fieldSelector = `${SELECTORS.field}[data-form-field="${escapeSelector(name)}"]`;
  const wrappers = Array.from(root.querySelectorAll(fieldSelector));
  if (wrappers.length) return wrappers;

  const indexedPrefix = `gold_${name}_`;
  const controls = [
    ...Array.from(root.querySelectorAll(formDom.getNameSelector(name))),
    ...Array.from(root.querySelectorAll(`[name^="${escapeSelector(indexedPrefix)}"]`)),
    ...(name === FIELD_NAMES.quantity ? Array.from(root.querySelectorAll(SELECTORS.quantityInput)) : []),
  ];

  return controls
    .map((control) => control.closest(SELECTORS.field) || control.parentElement)
    .filter((field, index, fields) => field && root.contains(field) && fields.indexOf(field) === index);
}

// Stamps ONLY this element. formDom.setState also stamps every descendant,
// because CSS selectors target data-form-state on child nodes. Gold rows do not
// want that, so the two are deliberately different and are named differently.
function setOwnState(element, state, enabled) {
  const states = new Set((element.getAttribute("data-form-state") || "").split(/\s+/).filter(Boolean));
  if (enabled) states.add(state);
  else states.delete(state);
  const nextState = Array.from(states).join(" ");
  if (nextState) element.setAttribute("data-form-state", nextState);
  else element.removeAttribute("data-form-state");
}

function setGoldStatus(element, state) {
  clearAndSet(element, state, GOLD_STATUS_STATES);
}

function setGoldItemStatus(element, state) {
  clearAndSet(element, state, GOLD_ITEM_STATES);
}

function clearAndSet(element, targetState, states) {
  states.forEach((s) => setOwnState(element, s, false));
  setOwnState(element, targetState, true);
}

function getTextValue(element) {
  return String(element?.textContent || "").replace(/\s+/g, " ").trim();
}

function readCmsPricingRow(row) {
  const data = {};

  row.querySelectorAll(SELECTORS.pricingField).forEach((field) => {
    const key = field.getAttribute("data-form-gold-pricing-field");
    if (!key) return;
    data[key] = getTextValue(field);
  });

  return data;
}

function normalizeCmsPricingRow(row) {
  const assetType = normalizeSlug(row.assetType);
  const itemType = normalizeSlug(row.itemType);
  const inputValue = normalizeSlug(row.inputValue);
  const label = String(row.label || "").trim();

  if (assetType && assetType !== "gold") return null;
  if (!["jewellery", "coin", "bar"].includes(itemType)) return null;
  if (!label) return null;

  return {
    itemType,
    bullionName: itemType === "jewellery" ? "" : inputValue,
    label,
    weightGrams: row.weightGrams,
    purityCarats: row.purityCarats,
    purityPercent: row.purityPercent,
    extraDiscountPercent: row.extraDiscountPercent,
  };
}

function readCmsPricingRows(form) {
  const rows = [];

  document.querySelectorAll(SELECTORS.pricingRow).forEach((row) => {
    if (row.closest("template")) return;
    rows.push(readCmsPricingRow(row));
  });

  return rows.map(normalizeCmsPricingRow).filter(Boolean);
}

function readPricing(form) {
  const rows = normalizePricingRows(readCmsPricingRows(form));

  if (!rows.length) {
    throw new Error("Gold pricing requires CMS rows marked with data-form-gold-pricing-row.");
  }

  return { rows };
}

function normalizePricingRows(rows = []) {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      const itemType = normalizeSlug(row.itemType);
      const bullionName = normalizeSlug(row.bullionName);
      const label = String(row.label || "").trim();

      if (!itemType || !label) return null;
      if (itemType !== "jewellery" && !bullionName) return null;

      return {
        itemType,
        bullionName,
        label,
        weightGrams: parseNumber(row.weightGrams),
        purityCarats: parseNumber(row.purityCarats),
        purityPercent: parseNumber(row.purityPercent),
        extraDiscountPercent: parseNumber(row.extraDiscountPercent),
      };
    })
    .filter(Boolean);
}

function getItemElements(form) {
  return Array.from(form.querySelectorAll(SELECTORS.item)).filter((item) => {
    return !item.closest("template") && !item.hidden && !item.closest("[data-form-state~='condition-hidden']");
  });
}

function getMaxItems(form) {
  const value = parseNumber(form?.getAttribute("data-form-gold-max-items"));
  return Number.isFinite(value) && value > 0 ? value : MAX_ITEMS;
}

function getItem(form, itemElement) {
  return {
    itemType: getItemFieldValue(itemElement, FIELD_NAMES.itemType),
    bullionName: getItemFieldValue(itemElement, FIELD_NAMES.bullionName),
    metalType: getItemFieldValue(itemElement, FIELD_NAMES.metalType),
    weightGrams: getItemFieldValue(itemElement, FIELD_NAMES.weightGrams),
    quantity: getItemFieldValue(itemElement, FIELD_NAMES.quantity),
  };
}

function findJewelleryRow(rows, metalType) {
  const carats = parseNumber(metalType);
  return rows.find((row) => row.itemType === "jewellery" && parseNumber(row.purityCarats) === carats) || null;
}

function findPricingRow(rows, item) {
  const itemType = normalizeSlug(item.itemType);
  const bullionName = normalizeSlug(item.bullionName);

  if (itemType === "jewellery") {
    return findJewelleryRow(rows, item.metalType);
  }

  if (bullionName === "other" || bullionName === "unsure") {
    return {
      itemType,
      bullionName,
      label: bullionName === "unsure" ? "Unsure" : "Other",
      weightGrams: NaN,
      purityCarats: NaN,
      purityPercent: NaN,
    };
  }

  return rows.find((row) => row.itemType === itemType && row.bullionName === bullionName) || null;
}

function isManualRow(row) {
  if (!row) return true;
  // Purity is type-locked (see getPurityRatio): jewellery reads carats, bullion reads percent.
  const itemType = normalizeSlug(row.itemType);
  const purity = itemType === "jewellery" ? Number(row.purityCarats) : Number(row.purityPercent);
  if (!Number.isFinite(purity) || purity <= 0) return true;
  if (itemType !== "jewellery") {
    const weight = Number(row.weightGrams);
    if (!Number.isFinite(weight) || weight <= 0) return true;
  }
  return false;
}

function getPurityRatio(row, item, itemType) {
  // Type-locked: jewellery purity comes from carats (CMS row, falling back
  // to the entered carat); coin/bar purity comes from percent. The other
  // field is ignored.
  const type = itemType || normalizeSlug(item.itemType);
  if (type === "jewellery") {
    if (Number.isFinite(row.purityCarats) && row.purityCarats > 0) return row.purityCarats / 24;
    const itemCarats = parseNumber(item.metalType);
    return Number.isFinite(itemCarats) && itemCarats > 0 ? itemCarats / 24 : NaN;
  }
  return Number.isFinite(row.purityPercent) && row.purityPercent > 0 ? row.purityPercent / 100 : NaN;
}

function getWeightGrams(row, item, itemType) {
  if (itemType !== "jewellery") {
    return Number.isFinite(row.weightGrams) && row.weightGrams > 0 ? row.weightGrams : 0;
  }
  const fieldWeight = parseNumber(item.weightGrams);
  if (Number.isFinite(fieldWeight) && fieldWeight > 0) return fieldWeight;
  return Number.isFinite(row.weightGrams) && row.weightGrams > 0 ? row.weightGrams : 0;
}

function getQuantity(item) {
  const quantity = parseNumber(item.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function getOfferRatio(key, itemType) {
  // Purchases use a per-item-type rate (config purchaseToValuePercentByItemType):
  // jewellery 86, coins and bars 88. Loans ignore it. A missing or invalid
  // entry falls through to the flat percentage below, never to 0 or 1.
  if (key === "purchase") {
    const byItemType = formConfig.gold.purchaseToValuePercentByItemType;
    const override = parseNumber(byItemType?.[normalizeSlug(itemType)]);
    if (Number.isFinite(override) && override > 0) return override / 100;
  }

  // Config stores whole percentages (88, 75); convert to a ratio here.
  const number = parseNumber(formConfig.gold[key === "purchase" ? "purchaseToValuePercent" : "loanToValuePercent"]);
  return Number.isFinite(number) && number > 0 ? number / 100 : NaN;
}

// The purchase rate is per item type, so a lead mixing jewellery with coins
// has no single rate. Reports the distinct rates applied, ascending ("86",
// "88", or "86, 88").
//
// Row-level extraDiscountPercent (e.g. Francs, American Eagles) is not folded
// in: it belongs to the row, not the rate, and already shows in the per-item
// values.
//
// Returns "" when nothing was priced; callers then use the flat config value.
function formatAppliedRatePercents(estimates, key) {
  const percents = [...new Set(
    estimates
      .map((estimate) => getOfferRatio(key, estimate.itemType))
      .filter((ratio) => Number.isFinite(ratio) && ratio > 0)
      .map((ratio) => roundMoney(ratio * 100)),
  )].sort((a, b) => a - b);

  return percents.join(", ");
}

// Spot discount multiplier (0.97 for the 3% discount), applied before the
// purchase/loan ratios. Affects the offers only; the displayed spot value
// uses the raw spot. 1 if the config is missing or invalid.
function getSpotOfferMultiplier() {
  const percent = parseNumber(formConfig.gold.spotDiscountPercent);
  return Number.isFinite(percent) && percent > 0 && percent < 100 ? 1 - percent / 100 : 1;
}

// extraDiscountPercent (CMS row) trims this row's purchase/loan ratios by a
// further whole percent, multiplicative on top of the base ratio: ratio ×
// (1 - extra/100), e.g. 6 → ×0.94. Blank/zero/out-of-range = ×1. Never
// affects the displayed spot value.
function getRowOfferMultiplier(row) {
  const percent = parseNumber(row?.extraDiscountPercent);
  return Number.isFinite(percent) && percent > 0 && percent < 100 ? 1 - percent / 100 : 1;
}

function mround(value, multiple = 0.5) {
  const number = Number(value);
  const step = Number(multiple);
  if (!Number.isFinite(number) || !Number.isFinite(step) || step === 0) return NaN;
  return roundMoney(Math.round(number / step) * step);
}

// Zoho amount fields take no decimals. Non-finite input becomes 0.
function roundWholePound(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function calculatePurchaseValue(itemType, weightGrams, purityRatio, quantity, spotGbpPerGram, offerAdjust = 1) {
  const purchaseRatio = getOfferRatio("purchase", itemType) * offerAdjust;
  if (!Number.isFinite(purchaseRatio) || purchaseRatio <= 0) return {
    purchasePerGram: NaN,
    purchasePerUnit: NaN,
    purchaseValue: NaN,
    purchaseValueRaw: NaN,
  };

  if (itemType === "jewellery") {
    const purchasePerGram = mround(purityRatio * spotGbpPerGram * purchaseRatio, 0.5);
    const purchasePerUnit = mround(weightGrams * purchasePerGram, 0.5);
    return {
      purchasePerGram,
      purchasePerUnit,
      purchaseValue: roundMoney(quantity * purchasePerUnit),
      purchaseValueRaw: quantity * purchasePerUnit,
      purchaseFormula: "MROUND(weightGrams * MROUND(purityRatio * spotGbpPerGram * purchaseRatio, 0.5), 0.5) * quantity",
    };
  }

  const purchasePerGram = NaN;
  const purchasePerUnit = mround(weightGrams * purityRatio * spotGbpPerGram * purchaseRatio, 0.5);
  return {
    purchasePerGram,
    purchasePerUnit,
    purchaseValue: roundMoney(quantity * purchasePerUnit),
    purchaseValueRaw: quantity * purchasePerUnit,
    purchaseFormula: "MROUND(weightGrams * purityRatio * spotGbpPerGram * purchaseRatio, 0.5) * quantity",
  };
}

function calculateLoanValue(itemType, weightGrams, purityRatio, quantity, spotGbpPerGram, offerAdjust = 1) {
  const loanRatio = getOfferRatio("loan") * offerAdjust;
  if (!Number.isFinite(loanRatio) || loanRatio <= 0) return {
    loanPerGram: NaN,
    loanPerUnit: NaN,
    loanValue: NaN,
    loanValueRaw: NaN,
  };

  if (itemType === "jewellery") {
    // Jewellery: round £/gram to 50p first, then round the per-item value.
    const loanPerGram = mround(purityRatio * spotGbpPerGram * loanRatio, 0.5);
    const loanPerUnit = mround(weightGrams * loanPerGram, 0.5);
    return {
      loanPerGram,
      loanPerUnit,
      loanValue: roundMoney(quantity * loanPerUnit),
      loanValueRaw: quantity * loanPerUnit,
      loanFormula: "MROUND(weightGrams * MROUND(purityRatio * spotGbpPerGram * loanRatio, 0.5), 0.5) * quantity",
    };
  }

  const loanPerGram = NaN;
  const loanPerUnit = mround(weightGrams * purityRatio * spotGbpPerGram * loanRatio, 0.5);
  return {
    loanPerGram,
    loanPerUnit,
    loanValue: roundMoney(quantity * loanPerUnit),
    loanValueRaw: quantity * loanPerUnit,
    loanFormula: "MROUND(weightGrams * purityRatio * spotGbpPerGram * loanRatio, 0.5) * quantity",
  };
}

function calculateEstimate(item, row, spotGbpPerGram) {
  // isManualRow already filters unusable purity/weight; purityRatio is finite here.
  if (isManualRow(row)) return createManualEstimate(item, row);

  const itemType = normalizeSlug(item.itemType);
  const purityRatio = getPurityRatio(row, item, itemType);
  const weightGrams = getWeightGrams(row, item, itemType);
  const quantity = getQuantity(item);
  const spotValue = weightGrams * purityRatio * quantity * spotGbpPerGram;
  const offerSpotGbpPerGram = spotGbpPerGram * getSpotOfferMultiplier();
  const rowOfferAdjust = getRowOfferMultiplier(row);
  // Recomputed here (not reused from calculatePurchaseValue/calculateLoanValue)
  // so the trace below reports the effective ratio actually used.
  const purchaseRatio = getOfferRatio("purchase", itemType) * rowOfferAdjust;
  const loanRatio = getOfferRatio("loan") * rowOfferAdjust;
  const purchase = calculatePurchaseValue(itemType, weightGrams, purityRatio, quantity, offerSpotGbpPerGram, rowOfferAdjust);
  const loan = calculateLoanValue(itemType, weightGrams, purityRatio, quantity, offerSpotGbpPerGram, rowOfferAdjust);

  return {
    label: row.label,
    itemType,
    bullionName: normalizeSlug(item.bullionName),
    metalType: String(item.metalType || "").trim(),
    quantity,
    weightGrams,
    purityRatio,
    spotValue: roundMoney(spotValue),
    purchaseValue: Number.isFinite(purchase.purchaseValue) ? purchase.purchaseValue : 0,
    loanValue: Number.isFinite(loan.loanValue) ? loan.loanValue : 0,
    calculation: {
      source: "live_spot_with_configured_purchase_rate",
      spotFormula: "weightGrams * purityRatio * quantity * spotGbpPerGram",
      purchaseFormula: purchase.purchaseFormula,
      loanFormula: loan.loanFormula,
      inputWeightGrams: weightGrams,
      purityRatio,
      purityPercent: roundMoney(purityRatio * 100),
      quantity,
      spotGbpPerGram,
      purchaseRatio,
      purchasePercent: Number.isFinite(purchaseRatio) ? roundMoney(purchaseRatio * 100) : 0,
      purchasePerGram: Number.isFinite(purchase.purchasePerGram) ? purchase.purchasePerGram : null,
      purchasePerUnit: Number.isFinite(purchase.purchasePerUnit) ? purchase.purchasePerUnit : null,
      loanRatio,
      loanPercent: Number.isFinite(loanRatio) ? roundMoney(loanRatio * 100) : 0,
      loanPerGram: Number.isFinite(loan.loanPerGram) ? loan.loanPerGram : null,
      loanPerUnit: Number.isFinite(loan.loanPerUnit) ? loan.loanPerUnit : null,
      spotValueRaw: spotValue,
      purchaseValueRaw: purchase.purchaseValueRaw,
      loanValueRaw: loan.loanValueRaw,
      spotValueRounded: roundMoney(spotValue),
      purchaseValueRounded: Number.isFinite(purchase.purchaseValue) ? purchase.purchaseValue : 0,
      loanValueRounded: Number.isFinite(loan.loanValue) ? loan.loanValue : 0,
      rounding: "spreadsheet-equivalent MROUND(value, 0.5) on pricing values, then nearest penny display",
    },
    manual: false,
  };
}

function createManualEstimate(item, row) {
  return {
    label: row.label,
    itemType: normalizeSlug(item.itemType),
    bullionName: normalizeSlug(item.bullionName),
    metalType: String(item.metalType || "").trim(),
    quantity: getQuantity(item),
    weightGrams: parseNumber(item.weightGrams),
    purityRatio: NaN,
    spotValue: 0,
    purchaseValue: 0,
    loanValue: 0,
    calculation: {
      source: "manual_quote_required",
      reason: "Pricing row has no usable purity or weight.",
    },
    manual: true,
    message: "",
  };
}

function validateItem(instance, itemElement, showErrors) {
  const item = getItem(instance.form, itemElement);
  const itemType = normalizeSlug(item.itemType);
  const bullionName = normalizeSlug(item.bullionName);
  const quantity = parseNumber(item.quantity);
  const row = findPricingRow(instance.pricingRows, item);
  let message = "";

  if (!itemType) message = "Choose an item type.";
  else if (!Number.isFinite(quantity) || quantity <= 0) message = "Enter a quantity.";
  else if (itemType === "jewellery") {
    const weight = parseNumber(item.weightGrams);
    if (!Number.isFinite(weight) || weight <= 0) message = "Enter the item weight.";
    else if (!item.metalType) message = "Choose the gold carat.";
    else if (!row) message = "Choose a supported gold carat.";
  } else if (itemType === "coin" || itemType === "bar") {
    if (!bullionName) message = "Choose the coin or bar.";
    else if (!row) message = "This coin or bar is not in the pricing list.";
  } else {
    message = "Choose a supported gold item type.";
  }

  setItemError(itemElement, message, showErrors);
  return { ok: !message, itemElement, item, row, message };
}

function validateForm(instance, options = {}) {
  const form = instance.form;
  const items = getItemElements(form);
  const showErrors = Boolean(options.showErrors);
  let message = "";

  if (!items.length) {
    setOwnState(form, "invalid", false);
    setOutput(form, "validation_error", "");
    return { ok: true, inactive: true, itemResults: [] };
  }

  const itemResults = items.map((item) => validateItem(instance, item, showErrors));
  const invalidItem = itemResults.find((result) => !result.ok);

  if (items.length > getMaxItems(form)) message = `Add no more than ${getMaxItems(form)} gold items.`;
  else if (invalidItem) message = invalidItem.message;
  else if (options.requirePrice && itemResults.some((result) => !isManualRow(result.row)) && !instance.quote) {
    message = instance.priceError ? "Gold price is unavailable. Please try again." : "Gold price is still loading. Please try again in a moment.";
  }

  setOwnState(form, "invalid", showErrors && Boolean(message));
  setOutput(form, "validation_error", showErrors ? message : "");

  if (message && options.shouldFocus) focusFirstInvalid(items, itemResults);

  return { ok: !message, inactive: false, message, itemResults };
}

function hasPricedItems(validation) {
  return validation.itemResults.some((result) => result.ok && !isManualRow(result.row));
}

function setItemError(itemElement, message, showErrors) {
  setOwnState(itemElement, "invalid", showErrors && Boolean(message));
  if (showErrors && message) itemElement.setAttribute("aria-invalid", "true");
  else itemElement.removeAttribute("aria-invalid");

  const error = itemElement.querySelector(SELECTORS.error);
  if (!error) return;

  error.textContent = showErrors ? message : "";
  error.hidden = !showErrors || !message;
}

function focusFirstInvalid(items, itemResults) {
  const invalidIndex = itemResults.findIndex((result) => !result.ok);
  if (invalidIndex < 0) return;

  const item = items[invalidIndex];
  const target = [
    FIELD_NAMES.itemType,
    FIELD_NAMES.bullionName,
    FIELD_NAMES.weightGrams,
    FIELD_NAMES.metalType,
    FIELD_NAMES.quantity,
  ].map((name) => getFieldWrappers(item, name)
    .flatMap((field) => Array.from(field.querySelectorAll("input, select, textarea")))
    .filter((control) => control.type !== "hidden" && formValues.shouldReadField(control))
    .find(Boolean)).find(Boolean);

  window.requestAnimationFrame(() => target?.focus?.());
}

async function fetchSpotPrice(form) {
  const workerBase = String(formConfig.uploads.workerBase || "").replace(/\/$/, "");

  if (!workerBase) {
    throw new Error("Gold price worker base is not configured.");
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${workerBase}${formConfig.gold.priceEndpoint}`, {
      signal: controller.signal,
      headers: {
        [formConfig.uploads.clientHeaderName]: formConfig.uploads.clientHeaderValue,
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || payload.message || `Gold price request failed (${response.status}).`);
    }

    const spotGbpPerGram = parseNumber(payload.spotGbpPerGram);
    const timestamp = parseNumber(payload.timestamp);
    const source = String(payload.source || "").trim();

    if (!Number.isFinite(spotGbpPerGram) || spotGbpPerGram <= 0) {
      throw new Error("Gold price response missing spotGbpPerGram.");
    }

    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error("Gold price response missing timestamp.");
    }

    if (!source) {
      throw new Error("Gold price response missing source.");
    }

    return {
      spotGbpPerGram,
      updatedAt: timestamp,
      source,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

function evaluate(instance, quote, validation) {
  const form = instance.form;
  const spotGbpPerGram = Number.isFinite(quote?.spotGbpPerGram) ? quote.spotGbpPerGram : 0;
  const enquiryType = normalizeSlug(getFieldValue(form, FIELD_NAMES.enquiryType));
  const estimates = [];
  // Slot-aligned (unlike `estimates`, which compacts out invalid items): index
  // i is item slot i+1, null if unpriced. persistItemSlotFields depends on
  // this alignment.
  const itemsBySlot = [];

  const itemResults = validation?.itemResults?.length
    ? validation.itemResults
    : getItemElements(form).map((itemElement) => {
      const item = getItem(form, itemElement);
      return { ok: true, itemElement, item, row: findPricingRow(instance.pricingRows, item) };
    });

  itemResults.forEach((result) => {
    const itemElement = result.itemElement;
    const item = result.item;
    const row = result.row;
    if (!result.ok || !row) {
      renderItemPending(itemElement);
      itemsBySlot.push(null);
      return;
    }

    const estimate = calculateEstimate(item, row, spotGbpPerGram);
    renderItemOutputs(itemElement, estimate, enquiryType);
    setGoldItemStatus(itemElement, estimate.manual ? "manual" : "priced");
    updateItemPrompt(itemElement);
    estimates.push(estimate);
    itemsBySlot.push(estimate);
  });

  const summary = calculateGoldSummary(estimates, enquiryType, quote, itemsBySlot);

  return {
    ...summary,
    validationMessage: validation.message || "",
  };
}

function calculateGoldSummary(estimates, enquiryType, quote, itemsBySlot = estimates) {
  const spotGbpPerGram = Number.isFinite(quote?.spotGbpPerGram) ? quote.spotGbpPerGram : 0;
  // Rate the purchase/loan offers are priced from; exposed because raw spot
  // alone can't reconstruct the offer.
  const spotDiscountPercent = parseNumber(formConfig.gold.spotDiscountPercent);
  const offerSpotGbpPerGram = roundMoney(spotGbpPerGram * getSpotOfferMultiplier());
  const spotTotal = estimates.reduce((sum, item) => sum + roundWholePound(item.spotValue), 0);
  const pricedEstimates = estimates.filter((item) => !item.manual);
  const manualCount = estimates.length - pricedEstimates.length;
  // Every customer/Zoho amount is a whole £; every total is the sum of its
  // whole-£ line items, not a rounded sum. Per-item pricing keeps pence
  // internally.
  const purchaseTotal = pricedEstimates.reduce((sum, item) => sum + roundWholePound(item.purchaseValue), 0);
  const loanTotal = pricedEstimates.reduce((sum, item) => sum + roundWholePound(item.loanValue), 0);
  // Sum of each item's whole-£ enquiry amount (loan→loan, sell/consign→
  // purchase, else the higher). Matches the per-item gold_item_N_amount calc.
  const indicativeValue = estimates.reduce((sum, item) => sum + roundWholePound(getDisplayValue(item, enquiryType)), 0);

  // Flat config percentage when no item was priced (e.g. a Describe Items lead).
  const purchaseRatePercent = formatAppliedRatePercents(pricedEstimates, "purchase")
    || String(formConfig.gold.purchaseToValuePercent);
  const loanRatePercent = formatAppliedRatePercents(pricedEstimates, "loan")
    || String(formConfig.gold.loanToValuePercent);

  const hasPricedEstimates = pricedEstimates.length > 0;
  const band = hasPricedEstimates ? getRateBand(loanTotal, formConfig.gold.rateBands) : null;
  const isAboveMax = hasPricedEstimates && !band;
  const loanInterestRate = band ? band.interestRate : 0;
  const loanApr = band ? band.apr : 0;
  const loanTermMonths = formConfig.gold?.loanTermMonths || 6;
  // Rounds once; total interest and repayment derive from this value exactly.
  const monthlyInterest = isAboveMax ? 0 : roundWholePound(loanTotal * (loanInterestRate / 100));
  const totalInterest = isAboveMax ? 0 : monthlyInterest * loanTermMonths;
  const repaymentAmount = isAboveMax ? 0 : loanTotal + totalInterest;
  const updatedAtSeconds = Number(quote?.updatedAt);
  const updatedAt = Number.isFinite(updatedAtSeconds) ? new Date(updatedAtSeconds * 1000) : new Date(NaN);

  return {
    status: "ready",
    source: quote ? quote.source : "",
    updatedAtLabel: Number.isFinite(updatedAt.getTime()) ? updatedAt.toLocaleString("en-GB") : "",
    spotGbpPerGram: roundMoney(spotGbpPerGram),
    spotGbpPerOunce: roundMoney(spotGbpPerGram * formConfig.gold.ouncesPerTroy),
    spotDiscountPercent: Number.isFinite(spotDiscountPercent) ? spotDiscountPercent : 0,
    offerSpotGbpPerGram,
    purchaseRatePercent,
    loanRatePercent,
    itemCount: estimates.length,
    manualCount,
    hasManualItems: manualCount > 0,
    spotTotal,
    purchaseTotal,
    loanTotal,
    indicativeValue,
    monthlyInterest,
    loanInterestRate,
    loanApr,
    loanTermMonths,
    totalInterest,
    repaymentAmount,
    isAboveMax,
    enquiryType,
    items: estimates,
    itemsBySlot,
  };
}

// Which figure the customer is shown, from what they said they want to do.
//
// enquiryType is normalizeSlug'd, so the live radio values arrive as "loan"
// and "sell_my_items". Sell must be matched explicitly rather than relying on
// the Math.max fallback, or a sell lead would show the loan figure if the
// loan rate ever exceeded the purchase rate.
//
// "consign" is priced as a sale; the value still exists on other lead forms.
//
// An unanswered enquiry_type shows the higher of the two.
function getDisplayValue(estimate, enquiryType) {
  if (enquiryType === "loan") return estimate.loanValue;
  if (enquiryType === "sell" || enquiryType === "sell_my_items" || enquiryType === "consign") {
    return estimate.purchaseValue;
  }
  return Math.max(estimate.purchaseValue, estimate.loanValue);
}

function renderItemOutputs(itemElement, estimate, enquiryType) {
  setItemSummaryVisibility(itemElement, true);

  itemElement.querySelectorAll(SELECTORS.itemOutput).forEach((output) => {
    const key = output.getAttribute("data-form-gold-item-output");
    if (key === "message") {
      writeOutput(output, "");
      return;
    }
    const displayValue = getDisplayValue(estimate, enquiryType);
    const value = {
      label: estimate.label,
      quantity: estimate.quantity,
      weight: estimate.weightGrams,
      spot_total: estimate.spotValue,
      purchase_total: estimate.purchaseValue,
      loan_total: estimate.loanValue,
      subtotal: displayValue,
      purity_ratio: estimate.purityRatio,
      status: estimate.manual ? "manual" : "priced",
    }[key];
    if (value == null) return;
    if (typeof value === "number" && !Number.isFinite(value)) {
      writeOutput(output, "");
      return;
    }
    if (!output.getAttribute("data-form-gold-format")) {
      if (ITEM_MONEY_KEYS.has(key)) output.setAttribute("data-form-gold-format", "money");
      else if (ITEM_NUMBER_KEYS.has(key)) output.setAttribute("data-form-gold-format", "number");
    }
    writeOutput(output, value);
  });
}

function getItemPrompt(itemElement) {
  const item = getItem(itemElement.closest(SELECTORS.form) || document, itemElement);
  const itemType = normalizeSlug(item.itemType);
  const bullionName = normalizeSlug(item.bullionName);
  const metalType = item.metalType;

  if (!itemType) return "Select type";
  if (itemType === "jewellery") {
    if (!metalType) return "Select carat";
    const weight = parseNumber(item.weightGrams);
    if (!Number.isFinite(weight) || weight <= 0) return "Enter weight to continue";
    return "";
  }
  if (itemType === "coin" || itemType === "bar") {
    if (!bullionName) return `Select ${itemType}`;
    if (bullionName === "other" || bullionName === "unsure") return MANUAL_QUOTE_PROMPT;
    return "";
  }
  return "Select type";
}

function updateItemPrompt(itemElement) {
  const promptMessage = getItemPrompt(itemElement);
  const promptEl = itemElement.querySelector("[data-form-gold-item-prompt] strong");
  if (promptEl) promptEl.textContent = promptMessage;
}

function renderItemPending(itemElement) {
  setGoldItemStatus(itemElement, "pending");
  setItemSummaryVisibility(itemElement, false);

  updateItemPrompt(itemElement);

  itemElement.querySelectorAll(SELECTORS.itemOutput).forEach((output) => {
    const key = output.getAttribute("data-form-gold-item-output");
    if (key === "status") writeOutput(output, "pending");
    else if (key === "message") writeOutput(output, getItemPrompt(itemElement));
    else writeOutput(output, "");
  });
}

function setItemSummaryVisibility(itemElement, hasEstimate) {
  const subtotalTargets = new Set(itemElement.querySelectorAll("[data-form-gold-item-subtotal]"));
  const promptTargets = new Set(itemElement.querySelectorAll("[data-form-gold-item-prompt]"));

  itemElement.querySelectorAll(SELECTORS.itemOutput).forEach((output) => {
    const summary = output.closest("[data-form-gold-item-subtotal]") || output.closest("p, div, output");
    if (summary) subtotalTargets.add(summary);
  });

  if (!promptTargets.size) {
    Array.from(itemElement.querySelectorAll("p, div, span, strong")).forEach((element) => {
      const text = String(element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (text === "choose gold type to continue") {
        promptTargets.add(element.closest("p, div") || element);
      }
    });
  }

  subtotalTargets.forEach((element) => {
    element.hidden = !hasEstimate;
    element.setAttribute("aria-hidden", hasEstimate ? "false" : "true");
  });

  promptTargets.forEach((element) => {
    element.hidden = hasEstimate;
    element.setAttribute("aria-hidden", hasEstimate ? "true" : "false");
  });
}

const MONEY_KEYS = new Set([
  "spot_price_gbp_gram", "spot_price_gbp_ounce", "spot_total", "purchase_total",
  "loan_total", "indicative_value", "monthly_interest", "total_interest", "repayment_amount"
]);
const NUMBER_KEYS = new Set(["item_count", "manual_count"]);
const RATE_KEYS = new Set(["interest_rate", "apr"]);
// Per-item formatting fallback, mirrors the summary keys below.
const ITEM_MONEY_KEYS = new Set(["spot_total", "purchase_total", "loan_total", "subtotal"]);
const ITEM_NUMBER_KEYS = new Set(["quantity", "weight"]);
// Shown in place of an item's figure when the calculator cannot price the row.
// Exported because quote-sheet.js prints the same sentence: the printed sheet
// must not word this differently from the screen it was printed from.
export const MANUAL_QUOTE_PROMPT =
  "Manual quote required — enter details and we'll get back to you";


function renderFormOutputs(form, summary) {
  const enquiryKeys = new Set(["monthly_interest", "interest_rate", "apr", "total_interest", "repayment_amount"]);

  form.querySelectorAll(SELECTORS.output).forEach((output) => {
    const key = output.getAttribute("data-form-gold-output");

    if (summary.isAboveMax && enquiryKeys.has(key)) {
      writeOutput(output, "Enquire");
      return;
    }

    const value = {
      status: summary.status,
      source: summary.source,
      updated_at: summary.updatedAtLabel,
      spot_price_gbp_gram: summary.spotGbpPerGram,
      spot_price_gbp_ounce: summary.spotGbpPerOunce,
      item_count: summary.itemCount,
      spot_total: summary.spotTotal,
      purchase_total: summary.purchaseTotal,
      loan_total: summary.loanTotal,
      indicative_value: summary.indicativeValue,
      monthly_interest: summary.monthlyInterest,
      interest_rate: summary.loanInterestRate,
      apr: summary.loanApr,
      total_interest: summary.totalInterest,
      repayment_amount: summary.repaymentAmount,
      manual_count: summary.manualCount,
      validation_error: summary.validationMessage,
      loan_duration: summary.loanTermMonths ? `${summary.loanTermMonths} months` : "",
    }[key];

    if (value == null) return;
    if (!output.getAttribute("data-form-gold-format")) {
      if (MONEY_KEYS.has(key)) output.setAttribute("data-form-gold-format", "money");
      else if (RATE_KEYS.has(key)) output.setAttribute("data-form-gold-format", "rate");
      else if (NUMBER_KEYS.has(key)) output.setAttribute("data-form-gold-format", "number");
    }
    writeOutput(output, value);
  });
}

function writeOutput(element, value) {
  const format = element.getAttribute("data-form-gold-format");
  const formatted = typeof value === "string"
    ? value
    : format === "money"
    ? formatMoney(value)
    : format === "number"
      ? formatNumber(value)
      : format === "rate"
      ? formatNumber(value, 2)
      : format === "percent"
        ? `${formatNumber((Number(value) || 0) * 100)}%`
        : value;

  if ("value" in element && /^(input|textarea)$/i.test(element.tagName)) element.value = formatted;
  else element.textContent = String(formatted ?? "");
}

function setOutput(form, key, value) {
  form.querySelectorAll(`${SELECTORS.output}[data-form-gold-output="${escapeSelector(key)}"]`).forEach((output) => {
    writeOutput(output, value);
  });
}

function persistSummary(form, summary) {
  const w = (name, value) => formValues.setHidden(form, name, value);
  w("gold_spot_price_gbp_gram", String(summary.spotGbpPerGram));
  w("gold_spot_price_gbp_ounce", String(summary.spotGbpPerOunce));
  // Emitted so purchase/loan is reconstructable from submitted data alone.
  w("gold_spot_discount_percent", String(summary.spotDiscountPercent));
  w("gold_offer_spot_price_gbp_gram", String(summary.offerSpotGbpPerGram));
  w("gold_item_count", String(summary.itemCount));
  w("gold_spot_total", String(summary.spotTotal));
  // Whole £; rounded once in calculateGoldSummary (see the rounding model there).
  w("gold_purchase_total", String(summary.purchaseTotal));
  w("gold_loan_total", String(summary.loanTotal));
  w("gold_indicative_value", String(summary.indicativeValue));
  // Zoho "Gold Total" = sum of the five gold_item_N_amount fields.
  w("gold_total", String(summary.indicativeValue));
  w("gold_monthly_interest", String(summary.monthlyInterest));
  w("gold_interest_rate", Number(summary.loanInterestRate).toFixed(1));
  w("gold_apr", String(summary.loanApr));
  w("gold_total_interest", String(summary.totalInterest));
  w("gold_repayment_amount", String(summary.repaymentAmount));
  w("gold_loan_term_months", String(summary.loanTermMonths));
  w("gold_loan_duration", summary.loanTermMonths ? `${summary.loanTermMonths} months` : "");
  w("gold_is_above_max", String(summary.isAboveMax));
  w("gold_pricing_source", summary.source);
  w("gold_pricing_updated_at", summary.updatedAtLabel);
  // Rates actually applied, not the flat config value (a jewellery lead
  // reports 86). See formatAppliedRatePercents.
  w("gold_purchase_rate_percent", summary.purchaseRatePercent);
  w("gold_loan_rate_percent", summary.loanRatePercent);
  w("gold_manual_item_count", String(summary.manualCount));
  persistItemSlotFields(form, summary);
}

function formatHiddenValue(value) {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
}

// Internal item type stays a lowercase slug (coin/bar/jewellery) — used by
// condition rules and pricing lookup — and is mapped to Zoho's case-sensitive
// picklist labels only at emit time.
const ITEM_TYPE_SUBMIT_LABELS = {
  coin: "Coin",
  bar: "Bar",
  jewellery: "Jewellery",
};

function toItemTypeSubmitLabel(itemType) {
  if (!itemType) return "";
  return ITEM_TYPE_SUBMIT_LABELS[itemType] || itemType;
}

// The carat as Zoho's Item_N_Metal picklist spells it ("18ct Gold"); a bare
// "18" matches no option. Coins and bars have no carat. Falls back to the raw
// value if the carat cannot be read.
function toItemMetal(item) {
  const raw = String(item?.metalType || "").trim();
  if (!raw || normalizeSlug(item?.itemType) !== "jewellery") return raw;

  const carats = parseNumber(raw);
  return Number.isFinite(carats) && carats > 0 ? `${carats}ct Gold` : raw;
}

// One combined per-item description:
//
//   Jewellery  ->  "9ct Gold Jewellery"
//   Coins      ->  "1/2 Oz Gold Krugerrand"  (CMS label as-is)
//   Bars       ->  "1g Gold Bar"             (CMS label as-is)
//
// Only jewellery is composed, from the carat plus the item-type label. This is
// not the value for Zoho's Metal picklist: that is gold_item_N_metal_type
// ("9ct Gold"), a fixed list the longer phrase is not on. Falls back to the
// plain label if the carat cannot be read.
function toItemDescription(item) {
  const label = String(item?.label || "").trim();
  if (normalizeSlug(item?.itemType) !== "jewellery") return label;

  const carats = parseNumber(item?.metalType);
  if (!Number.isFinite(carats) || carats <= 0) return label;

  const kind = toItemTypeSubmitLabel(item?.itemType) || "Jewellery";
  return `${carats}ct Gold ${kind}`;
}

function persistItemSlotFields(form, summary) {
  const w = (name, value) => formValues.setHidden(form, name, formatHiddenValue(value));

  const slotCount = Math.max(MAX_ITEMS, getMaxItems(form));
  for (let index = 1; index <= slotCount; index += 1) {
    const item = summary.itemsBySlot[index - 1] || null;

    w(`gold_item_${index}_type`, toItemTypeSubmitLabel(item?.itemType));
    // Zoho's Item_N_Metal picklist holds "9ct Gold" ... "24ct Gold". Zoho
    // stores unlisted strings without error, so the format must match.
    w(`gold_item_${index}_metal_type`, toItemMetal(item));
    w(`gold_item_${index}_weight_grams`, item?.weightGrams);
    w(`gold_item_${index}_quantity`, item?.quantity);
    w(`gold_item_${index}_bullion_name`, item?.bullionName);
    // Combined description, not the raw label; see toItemDescription.
    w(`bullion_name_${index}`, item ? toItemDescription(item) : "");
    // Feeds Zoho's Item_N_Bullion_Type, a coin-and-bar picklist: a valid
    // option for coins and bars, empty for jewellery (no valid value) so Zoho
    // can group and filter on it. Also empty for a manual row; "Other",
    // "Other Coins" and "Unsure" are valid options, so send the label here if
    // a bullion select ever offers Other/Unsure again.
    w(
      `gold_item_${index}_bullion_type`,
      item && !item.manual && normalizeSlug(item.itemType) !== "jewellery" ? item.label : "",
    );
    // Same value as gold_item_${index}_weight_grams, which Item_N_Weight reads.
    w(`weight_grams_${index}`, item?.weightGrams);
    w(`gold_item_${index}_label`, item?.label);
    // Whole £; Σ gold_item_N_purchase_value = gold_purchase_total (etc).
    w(`gold_item_${index}_spot_value`, item ? roundWholePound(item.spotValue) : "");
    w(`gold_item_${index}_purchase_value`, item ? roundWholePound(item.purchaseValue) : "");
    w(`gold_item_${index}_loan_value`, item ? roundWholePound(item.loanValue) : "");
    // Same branch as summary indicativeValue (loan→loan, sell/consign→
    // purchase, else higher), via getDisplayValue. Empty for unused slots.
    w(`gold_item_${index}_amount`, item ? roundWholePound(getDisplayValue(item, summary.enquiryType)) : "");
    // Slot 1 always sends "Gold" so a Describe Items lead (no priced items)
    // still records an asset type. Slots 2-5 send it only when used, so an
    // empty slot does not create a Zoho item row.
    w(`gold_item_${index}_asset_type`, item || index === 1 ? "Gold" : "");
    w(`gold_item_${index}_manual`, item ? item.manual : "");
  }
}

const REPEATER_FIELDS = [
  FIELD_NAMES.itemType,
  FIELD_NAMES.bullionName,
  FIELD_NAMES.metalType,
  FIELD_NAMES.weightGrams,
  FIELD_NAMES.quantity,
];

function getFieldIdSuffix(field, fieldName, fallback) {
  const rule = [
    field.getAttribute("data-form-show-if"),
    field.getAttribute("data-form-show-if-group"),
    field.getAttribute("data-form-hide-if"),
    field.getAttribute("data-form-hide-if-group"),
  ].filter(Boolean).join(" ");
  const valueMatch = rule.match(/=\s*([a-zA-Z0-9_-]+)/);
  const ruleSuffix = normalizeSlug(valueMatch?.[1]);
  if (ruleSuffix && !ruleSuffix.includes(fieldName)) return ruleSuffix;
  return fallback;
}

function getRepeaterFieldWrappers(itemElement, fieldName) {
  return getFieldWrappers(itemElement, fieldName);
}

function syncRepeaterFieldNames(itemElement, index) {
  REPEATER_FIELDS.forEach((fieldName) => {
    const indexedName = getIndexedFieldName(fieldName, index);
    const fields = getRepeaterFieldWrappers(itemElement, fieldName);
    const hasMultipleFields = fields.length > 1;

    fields.forEach((field, fieldIndex) => {
      const controls = Array.from(field.querySelectorAll("input, select, textarea"))
        .filter((control) => control.type !== "hidden");
      if (!controls.length) return;

      const fieldSuffix = getFieldIdSuffix(field, fieldName, String(fieldIndex + 1));
      const fieldBaseId = hasMultipleFields ? `${indexedName}_${fieldSuffix}` : indexedName;
      if (field.id) {
        field.id = `${fieldBaseId}_field`;
      }

      if (controls.some((control) => control.type === "radio" || control.type === "checkbox")) {
        field.setAttribute("data-form-choice-group", indexedName);
      }

      controls.forEach((control, controlIndex) => {
        const oldId = control.id;
        const suffix = control.type === "radio" || control.type === "checkbox"
          ? normalizeSlug(control.value) || String(controlIndex + 1)
          : fieldSuffix;
        const controlName = hasMultipleFields && control.type !== "radio" && control.type !== "checkbox"
          ? `${indexedName}_${suffix}`
          : indexedName;
        const id = suffix && (hasMultipleFields || controls.length > 1) ? `${indexedName}_${suffix}` : indexedName;

        control.name = controlName;
        control.id = id;

        if (control.tagName === "SELECT") {
          Array.from(control.options || []).forEach((option, optionIndex) => {
            if (!option.id) return;
            const optionSuffix = normalizeSlug(option.value || option.textContent) || String(optionIndex + 1);
            option.id = `${control.id}_${optionSuffix}`;
          });
        }

        if (!oldId) return;
        field.querySelectorAll(`label[for="${escapeSelector(oldId)}"]`).forEach((label) => {
          label.setAttribute("for", control.id);
        });
      });

      field.querySelectorAll("[id]").forEach((element, elementIndex) => {
        if (element === field || controls.includes(element)) return;
        const originalId = element.getAttribute("data-form-gold-original-id") || element.id;
        element.setAttribute("data-form-gold-original-id", originalId);
        const suffix = normalizeSlug(originalId) || String(elementIndex + 1);
        element.id = `${fieldBaseId}_${suffix}`;
      });
    });
  });

  syncRowConditionRules(itemElement, index);
}

// Rules are rewritten from the AUTHORED text every time, never from the last
// rewrite. The authored value is stashed on `<attr>-authored` the first time a
// row is synced, and each later sync re-derives from that stash.
//
// addItem() clones the previous row, so item 2 arrives carrying item 1's
// expanded rule (`gold_bullion_name_1_coin = other OR ...`). The pattern below
// cannot re-match past the `_coin` / `_bar` suffix, so rewriting in place
// would leave items 2-5 pointing at item 1's controls.
function authoredRule(element, attr) {
  const stash = `${attr}-authored`;
  const stashed = element.getAttribute(stash);
  if (stashed !== null) return stashed;

  const authored = element.getAttribute(attr);
  if (authored) element.setAttribute(stash, authored);
  return authored;
}

function syncRowConditionRules(itemElement, index) {
  const attrs = ["data-form-show-if", "data-form-hide-if", "data-form-hide-if-any"];
  const groupAttrs = ["data-form-show-if-group", "data-form-hide-if-group", "data-form-hide-if-any-group"];
  const replacements = REPEATER_FIELDS.map((fieldName) => {
    const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return {
      fieldName,
      indexedName: getIndexedFieldName(fieldName, index),
      pattern: new RegExp(`(^|[;,]\\s*|\\bOR\\s+|!\\s*)(?:gold_)?${escapedField}(?:_\\d+)?(?=\\s*(?:>=|<=|!=|=|>|<)|\\s*(?:[,;]|$))`, "g"),
      groupPattern: new RegExp(`^(?:gold_)?${escapedField}(?:_\\d+)?$`),
    };
  });

  itemElement.querySelectorAll(attrs.map((attr) => `[${attr}]`).join(",")).forEach((element) => {
    attrs.forEach((attr) => {
      let rule = authoredRule(element, attr);
      if (!rule) return;
      replacements.forEach(({ indexedName, pattern }) => {
        rule = rule.replace(pattern, `$1${indexedName}`);
      });
      replacements.forEach(({ fieldName, indexedName }) => {
        const fields = getRepeaterFieldWrappers(itemElement, fieldName);
        if (fields.length <= 1) return;
        const names = fields.map((field, fieldIndex) => {
          return `${indexedName}_${getFieldIdSuffix(field, fieldName, String(fieldIndex + 1))}`;
        });
        const expressionPattern = new RegExp(`\\b${indexedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(>=|<=|!=|=|>|<)\\s*([^,;]+?)(?=\\s*(?:[,;]|$))`, "g");
        rule = rule.replace(expressionPattern, (match, operator, expected) => {
          const cleanExpected = expected.trim();
          return names.map((name) => `${name} ${operator} ${cleanExpected}`).join(" OR ");
        });
      });
      element.setAttribute(attr, rule);
    });
  });

  itemElement.querySelectorAll(groupAttrs.map((attr) => `[${attr}]`).join(",")).forEach((element) => {
    groupAttrs.forEach((attr) => {
      const groupValue = authoredRule(element, attr);
      if (!groupValue) return;
      const replacement = replacements.find(({ groupPattern }) => groupPattern.test(groupValue.trim()));
      if (!replacement) return;

      const fields = getRepeaterFieldWrappers(itemElement, replacement.fieldName);
      if (fields.length <= 1) {
        element.setAttribute(attr, replacement.indexedName);
        return;
      }

      const ownWrapper = element.closest(`${SELECTORS.field}[data-form-field="${escapeSelector(replacement.fieldName)}"]`);
      const ownIndex = fields.indexOf(ownWrapper);
      const controls = ownWrapper
        ? Array.from(ownWrapper.querySelectorAll("input, select, textarea")).filter((control) => control.type !== "hidden")
        : [];
      const isChoiceGroup = controls.some((control) => control.type === "radio" || control.type === "checkbox");
      const suffixedName = ownWrapper && !isChoiceGroup
        ? `${replacement.indexedName}_${getFieldIdSuffix(ownWrapper, replacement.fieldName, String(ownIndex + 1))}`
        : replacement.indexedName;
      element.setAttribute(attr, suffixedName);
    });
  });
}

function resetItem(itemElement, options = {}) {
  const shouldCheckFirstType = options.checkFirstType !== false;

  itemElement.querySelectorAll("input, select, textarea").forEach((field) => {
    if (field.type === "hidden") return;
    if (field.type === "checkbox" || field.type === "radio") field.checked = false;
    else {
      field.value = field.matches(SELECTORS.quantityInput) ? "1" : "";
      if (field.tagName === "SELECT" && field.options.length) field.selectedIndex = 0;
    }
    field.removeAttribute("aria-invalid");
  });

  itemElement.querySelectorAll("[data-form-state]").forEach((element) => {
    setOwnState(element, "invalid", false);
    setOwnState(element, "filled", false);
    setOwnState(element, "selected", false);
    setOwnState(element, "condition-hidden", false);
    setOwnState(element, "hidden", false);
    element.hidden = false;
    element.removeAttribute("aria-hidden");
    element.removeAttribute("inert");
    element.style.removeProperty("display");
  });

  itemElement.querySelectorAll("[data-form-select-option]").forEach((option) => {
    option.setAttribute("aria-selected", "false");
  });

  itemElement.querySelectorAll("[data-form-select]").forEach((select) => {
    const value = select.querySelector("[data-form-select-value]");
    const native = select.querySelector("[data-form-select-native]");
    if (value) value.textContent = native?.options?.[0]?.textContent || "Select option";
  });

  const firstType = getFieldWrappers(itemElement, FIELD_NAMES.itemType)[0]?.querySelector("input[type='radio']");
  if (shouldCheckFirstType && firstType) {
    firstType.checked = true;
    firstType.dispatchEvent(new Event("input", { bubbles: true }));
    firstType.dispatchEvent(new Event("change", { bubbles: true }));
  }

  itemElement.querySelectorAll(SELECTORS.error).forEach((error) => {
    error.textContent = "";
    error.hidden = true;
  });

  itemElement.querySelectorAll(SELECTORS.itemOutput).forEach((output) => {
    writeOutput(output, "");
  });
  renderItemPending(itemElement);
}

function updateItemTitle(item, itemIndex) {
  const title = item.querySelector(SELECTORS.itemTitle);
  if (title) title.textContent = `Item ${itemIndex}`;
}

function updateRepeaterState(instance) {
  const items = getItemElements(instance.form);
  const maxItems = getMaxItems(instance.form);

  items.forEach((item, index) => {
    const itemIndex = index + 1;
    item.setAttribute("data-form-gold-item-index", String(itemIndex));
    syncRepeaterFieldNames(item, itemIndex);
    setOwnState(item, "first", index === 0);
    setOwnState(item, "last", index === items.length - 1);
    updateItemTitle(item, itemIndex);
  });

  instance.form.querySelectorAll(SELECTORS.action).forEach((action) => {
    const name = action.getAttribute("data-form-gold-action");
    if (name === "add-item") {
      const atMax = items.length >= maxItems;
      action.disabled = atMax;
      const wrapper = action.closest(".button") || action;
      wrapper.hidden = atMax;
      wrapper.style.setProperty("display", atMax ? "none" : "", "important");
    }
  });
}

function addItem(instance) {
  const form = instance.form;
  const items = getItemElements(form);
  if (items.length >= getMaxItems(form)) return;

  const list = form.querySelector(SELECTORS.itemList);
  const source = items[items.length - 1];
  if (!list || !source) {
    formLogger.warn(form, "gold add-item requires an item list with one item");
    return;
  }

  const item = source.cloneNode(true);
  resetItem(item, { checkFirstType: false });
  list.appendChild(item);
  updateRepeaterState(instance);

  const firstType = getFieldWrappers(item, FIELD_NAMES.itemType)[0]?.querySelector("input[type='radio']");
  if (firstType) {
    firstType.checked = true;
    firstType.dispatchEvent(new Event("input", { bubbles: true }));
    firstType.dispatchEvent(new Event("change", { bubbles: true }));
  }

  initSelects(item);
  formApp.refresh(form);
  instance.refresh();
}

function scrollToForm(form) {
  const formElement = form.closest?.("[data-form-gold]") || form;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const rect = formElement.getBoundingClientRect();
      const offset = 20;
      const targetTop = Math.max(window.pageYOffset + rect.top - offset, 0);
      const shouldScroll = rect.top < 0 || rect.top > Math.min(window.innerHeight * 0.35, 260);
      if (shouldScroll) {
        window.scrollTo({ top: targetTop, behavior: "smooth" });
      }
    });
  });
}

function clearItems(instance) {
  const items = getItemElements(instance.form);
  items.slice(1).forEach((item) => item.remove());
  if (items[0]) resetItem(items[0]);
  updateRepeaterState(instance);
  instance.refresh();
  scrollToForm(instance.form);
}

function updateQuantity(action) {
  const wrap = action.closest(SELECTORS.quantity);
  const item = action.closest(SELECTORS.item);
  const input = wrap?.querySelector(SELECTORS.quantityInput) || item?.querySelector(SELECTORS.quantityInput);
  if (!input) return;

  const direction = action.getAttribute("data-form-gold-quantity-action") === "decrement" ? -1 : 1;
  const current = parseNumber(input.value);
  input.value = String(Math.max(1, (Number.isFinite(current) ? current : 1) + direction));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function removeItem(instance, action) {
  const items = getItemElements(instance.form);
  const item = action.closest(SELECTORS.item);
  if (!item) return;

  if (items.length <= 1) {
    resetItem(item);
    updateRepeaterState(instance);
    instance.refresh();
    return;
  }

  item.remove();
  updateRepeaterState(instance);
  instance.refresh();
}

function handleGoldAction(instance, event, action) {
  const name = action.getAttribute("data-form-gold-action");
  if (!["add-item", "remove-item", "clear"].includes(name)) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (name === "add-item") addItem(instance);
  if (name === "remove-item") removeItem(instance, action);
  if (name === "clear") clearItems(instance);
}

function isBlockingFormAction(action) {
  return ["next", "submit", "redirect"].includes(action?.getAttribute("data-form-action"));
}

function createInstance(form) {
  const pricing = readPricing(form);
  const instance = {
    form,
    pricingRows: pricing.rows,
    quote: null,
    quotePromise: null,
    priceError: null,
    refresh: null,
  };

  instance.refresh = debounce(() => refresh(instance), 140);
  instance.quotePromise = fetchSpotPrice(form).then((quote) => {
    instance.quote = quote;
    instance.priceError = null;
    formLogger.log(instance.form, "gold price loaded", quote);
    return quote;
  }).catch((error) => {
    instance.priceError = error;
    throw error;
  });
  instance.quotePromise.then(() => {
    instance.refresh();
  }).catch((error) => {
    formLogger.error(instance.form, "gold price preload failed", error);
    instance.refresh();
  });
  formLogger.log(form, "gold module initialised", { rows: pricing.rows.length });
  return instance;
}

async function refresh(instance) {
  const form = instance.form;

  try {
    updateRepeaterState(instance);

    const validation = validateForm(instance);

    if (validation.inactive) {
      const summary = evaluate(instance, null, validation);
      setGoldStatus(form, "ready");
      renderFormOutputs(form, summary);
      persistSummary(form, summary);
      formApp.refresh(form);
      return;
    }

    if (!validation.ok) {
      const summary = evaluate(instance, instance.quote, validation);
      setGoldStatus(form, "ready");
      renderFormOutputs(form, summary);
      persistSummary(form, summary);
      formApp.refresh(form);
      return;
    }

    if (!hasPricedItems(validation)) {
      const summary = evaluate(instance, null, validation);
      setGoldStatus(form, summary.status);
      renderFormOutputs(form, summary);
      persistSummary(form, summary);
      formApp.refresh(form);
      return;
    }

    setGoldStatus(form, "loading");
    const quote = instance.quote || await instance.quotePromise;
    const summary = evaluate(instance, quote, validation);

    setGoldStatus(form, summary.status);
    renderFormOutputs(form, summary);
    persistSummary(form, summary);
    formApp.refresh(form);
  } catch (error) {
    formLogger.error(form, "gold refresh failed", error);
    setGoldStatus(form, "error");
    setOutput(form, "status", "error");
  }
}

function bindInstance(instance) {
  const form = instance.form;

  form.addEventListener("input", (event) => {
    const field = event.target;
    if (field && (field.type === "number" || field.inputMode === "decimal" || field.inputMode === "numeric") && field.value && field.value.startsWith("-")) {
      field.value = field.value.replace(/^-/, "");
    }
  });

  form.addEventListener("change", (event) => {
    const field = event.target;
    if (field && (field.type === "number" || field.inputMode === "decimal" || field.inputMode === "numeric") && field.value) {
      const num = parseFloat(field.value);
      if (Number.isFinite(num) && num < 0) {
        field.value = String(Math.abs(num));
      }
    }
  });

  form.addEventListener("click", (event) => {
    const quantityAction = event.target.closest?.(SELECTORS.quantityAction);
    if (quantityAction && form.contains(quantityAction)) {
      event.preventDefault();
      updateQuantity(quantityAction);
      return;
    }

    const goldAction = event.target.closest?.(SELECTORS.action);
    if (goldAction && form.contains(goldAction)) {
      handleGoldAction(instance, event, goldAction);
      return;
    }

    const formAction = event.target.closest?.(SELECTORS.formAction);
    if (formAction && form.contains(formAction) && isBlockingFormAction(formAction)) {
      const validation = validateForm(instance, { showErrors: true, shouldFocus: true, requirePrice: true });
      if (!validation.ok) {
        formLogger.warn(form, "gold blocked form action", validation.message);
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
  }, true);

  form.addEventListener("submit", (event) => {
    const validation = validateForm(instance, { showErrors: true, shouldFocus: true, requirePrice: true });
    if (!validation.ok) {
      formLogger.warn(form, "gold blocked submit", validation.message);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  form.addEventListener("input", instance.refresh);
  form.addEventListener("change", () => {
    instance.refresh();
  });
  instance.refresh();
}

export function initGoldForms(scope = document) {
  const forms = [
    ...(scope.matches?.(SELECTORS.form) ? [scope] : []),
    ...Array.from(scope.querySelectorAll(SELECTORS.form)),
  ];

  forms.forEach((form) => {
    if (initializedForms.has(form)) return;

    try {
      const instance = createInstance(form);
      instances.set(form, instance);
      bindInstance(instance);
      // Latch only after setup succeeds, so a form whose createInstance threw
      // (e.g. CMS rows injected late) retries on the next initGoldForms pass.
      initializedForms.add(form);
    } catch (error) {
      initializedForms.delete(form);
      formLogger.error(form, "gold init failed", error);
      setGoldStatus(form, "error");
    }
  });
}

export const goldCalculationTestHooks = {
  normalizePricingRows,
  findPricingRow,
  calculateEstimate,
  calculateGoldSummary,
  evaluate,
  getItem,
  persistSummary,
  persistItemSlotFields,
  getFieldWrappers,
  updateRepeaterState,
  getOfferRatio,
  calculatePurchaseValue,
  calculateLoanValue,
  getSpotOfferMultiplier,
  getRowOfferMultiplier,
  getDisplayValue,
  getPurityRatio,
  mround,
  roundWholePound,
  isManualRow,
  renderFormOutputs,
};
