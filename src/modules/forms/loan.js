import { formConfig } from "./config.js";
import { formLogger, formApp, formValues } from "./core.js";
import {roundMoney, formatMoney, parseNumber, getRateBand} from "./numbers.js";
import { debounce } from "../../utils/debounce.js";
import { initRangeSliders } from "./range-slider.js";

const SELECTORS = {
  form: "[data-form-loan]",
  amountInput: "[data-form-loan-amount]",
  durationRadio: "[name='loan_duration']",
  output: "[data-form-loan-output]",
};

function init(form) {
  if (form.hasAttribute("data-form-loan-initialised")) return;
  form.setAttribute("data-form-loan-initialised", "true");

  const input = form.querySelector(SELECTORS.amountInput);
  const radios = form.querySelectorAll(SELECTORS.durationRadio);

  if (!input) return;

  const refresh = debounce(() => {
    try { doRefresh(form); const ctrl = formApp.getFormByRoot?.(form); if (ctrl) formApp.refresh(ctrl); } catch (error) { formLogger.error(form, "loan refresh failed", error); }
  }, 120);

  initRangeSliders(form);

  input.addEventListener("input", refresh);
  radios.forEach((r) => r.addEventListener("change", refresh));
  refresh();
}

function doRefresh(form) {
  const amount = getAmount(form);
  const months = getDuration(form);

  // setHidden matches `input[name=...]` only. A <select> with one of these
  // names would get a second control appended beside it, and Webflow submits
  // the last one in the DOM. (`requested_amount` is a <select> on the
  // product-finder form, which loan.js does not touch.)
  const setField = (name, value) => formValues.setHidden(form, name, String(value));

  if (!Number.isFinite(amount) || amount <= 0) {
    form.removeAttribute("data-form-loan-enquiry");
    form.removeAttribute("data-form-loan-saving");
    setOutput(form, "loan_amount", "");
    setOutput(form, "months", "");
    setOutput(form, "interest_rate", "");
    setOutput(form, "monthly_interest", "");
    setOutput(form, "total_interest", "");
    setOutput(form, "total_redeem", "");
    setHelp(form, "");
    setField("requested_amount", "");
    setField("loan_duration_months", "");
    setField("loan_interest_rate", "");
    setField("loan_is_enquiry", "");
    setField("loan_savings", "");
    return;
  }

  const summary = calculateLoanSummary(amount, months);
  const { isEnquiry, rate, monthlyInterest, totalInterest, totalRedeem, savings, hasSaving } = summary;
  const helpValue = formatLoanHelpMessage(summary);

  form.setAttribute("data-form-loan-enquiry", String(isEnquiry));
  form.setAttribute("data-form-loan-saving", String(hasSaving));

  setOutput(form, "loan_amount", formatMoney(amount));
  setOutput(form, "months", String(months));
  // 1 decimal always (6.5%, 6.0%) — not formatNumber, which gold.js shares
  // and defaults to 0 decimals. Only reached when a band matched, so never
  // "0.0%"; loan_interest_rate below keeps the raw numeric value.
  setOutput(form, "interest_rate", isEnquiry ? "" : `${rate.toFixed(1)}%`);
  setOutput(form, "monthly_interest", isEnquiry ? "" : formatMoney(monthlyInterest));
  setOutput(form, "total_interest", isEnquiry ? "" : formatMoney(totalInterest));
  setOutput(form, "total_redeem", isEnquiry ? "" : formatMoney(totalRedeem));
  setHelp(form, helpValue);

  setField("requested_amount", amount);
  setField("loan_duration_months", months);
  setField("loan_interest_rate", isEnquiry ? "" : rate);
  setField("loan_is_enquiry", isEnquiry);
  setField("loan_savings", savings);
}

export function calculateLoanSummary(amount, months, config = formConfig.loan) {
  const band = getRateBand(amount, config.rateBands);
  const competitorBand = getRateBand(amount, config.competitorRates);
  // The slider caps at config.loan.max ("£15,000+"); at or above it, this
  // calculator treats the amount as an enquiry (no rate submitted). Scoped
  // to the loan calculator only — getRateBand/rateBands are unchanged, so
  // gold-derived loans of exactly £15,000 stay quotable at 6%.
  const isEnquiry = !band || amount >= config.max;

  const rate = band ? band.interestRate : 0;
  const monthlyInterest = isEnquiry ? 0 : roundMoney(amount * (rate / 100));
  const totalInterest = isEnquiry ? 0 : roundMoney(monthlyInterest * months);
  const totalRedeem = isEnquiry ? 0 : roundMoney(amount + totalInterest);

  const competitorRate = competitorBand ? competitorBand.rate : 0;
  // Competitor rates are MONTHLY, matching Suttons' monthly interestRate —
  // do not divide by 12.
  const competitorTotal = competitorBand ? roundMoney(amount * (competitorRate / 100) * months) : 0;
  const competitorRedeem = competitorBand ? roundMoney(amount + competitorTotal) : 0;
  const savings = competitorBand && !isEnquiry ? roundMoney(competitorRedeem - totalRedeem) : 0;

  return {
    isEnquiry,
    rate,
    monthlyInterest,
    totalInterest,
    totalRedeem,
    competitorRate,
    competitorTotal,
    competitorRedeem,
    savings,
    hasSaving: savings > 0,
    hasCompetitorRate: Boolean(competitorBand),
  };
}

export function formatLoanSavingsMessage(summary, config = formConfig.loan) {
  if (!summary) {
    return "";
  }

  if (summary?.isEnquiry) {
    return "";
  }

  if (!summary?.hasCompetitorRate) {
    return "";
  }

  if (summary?.hasSaving) {
    return `Save ${formatMoney(summary.savings)} compared to ${config.competitorLabel}`;
  }

  return config.noSavingMessage;
}

export function formatLoanHelpMessage(summary, config = formConfig.loan) {
  return formatLoanSavingsMessage(summary, config);
}

export const loanCalculationTestHooks = {
  doRefresh,
};

function getAmount(form) {
  const input = form.querySelector(SELECTORS.amountInput);
  const text = (input?.textContent || input?.value || "").replace(/[^0-9.]/g, "");
  return parseNumber(text);
}

function getDuration(form) {
  const checked = form.querySelector(`${SELECTORS.durationRadio}:checked`);
  const value = parseNumber(checked?.value);
  return Number.isFinite(value) && value > 0 ? value : formConfig.loan.defaultDuration;
}

function setOutput(form, key, value) {
  const str = String(value ?? "");
  form.querySelectorAll(`${SELECTORS.output}[data-form-loan-output="${key}"]`).forEach((el) => {
    setTextWithEmptyState(el, str);
  });
}

function setHelp(form, value) {
  const str = String(value ?? "");
  const helpTargets = form.querySelectorAll(`${SELECTORS.output}[data-form-loan-output="help"]`);
  if (!helpTargets.length) {
    setOutput(form, "savings", str);
    return;
  }

  helpTargets.forEach((el) => {
    setTextWithEmptyState(el, str);
  });
}

function setTextWithEmptyState(el, value) {
  el.textContent = value;
  const states = new Set((el.getAttribute('data-form-state') || '').split(' ').filter(Boolean));
  if (!value) {
    states.add('empty');
  } else {
    states.delete('empty');
  }
  const next = Array.from(states).join(' ');
  if (next) el.setAttribute('data-form-state', next);
  else el.removeAttribute('data-form-state');
}

export function initLoanForms(scope = document) {
  const forms = [
    ...(scope.matches?.(SELECTORS.form) ? [scope] : []),
    ...scope.querySelectorAll(SELECTORS.form),
  ];
  forms.forEach(init);
}
