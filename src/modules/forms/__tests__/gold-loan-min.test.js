import { afterEach, describe, expect, it } from 'vitest'
import { goldCalculationTestHooks } from '../gold.js'
import { formConfig } from '../config.js'

const { validateForm, normalizePricingRows, findPricingRow, calculateEstimate, calculateGoldSummary, renderFormOutputs, persistSummary } = goldCalculationTestHooks

const LOAN_MIN = formConfig.gold.loanMin

const pricingRows = normalizePricingRows([
  { itemType: 'Bar', bullionName: '1g_bar', label: '1g Gold Bar', purityPercent: '99.99', weightGrams: '1' },
  { itemType: 'Coin', bullionName: 'sovereign', label: 'Sovereign', purityPercent: '91.67', weightGrams: '7.99' },
])

const quote = { spotGbpPerGram: 98.16, updatedAt: 1781172000, source: 'test' }

function buildInstance(enquiryType, items) {
  const form = document.createElement('form')
  form.setAttribute('data-form-gold', '')
  form.innerHTML = `
    <input type="radio" name="enquiry_type" value="${enquiryType}" checked>
    ${items.map(([itemType, bullionName, quantity = 1], i) => `
      <div data-form-gold-item data-form-gold-item-index="${i + 1}">
        <input type="radio" name="gold_item_type_${i + 1}" value="${itemType}" checked>
        <input name="gold_bullion_name_${i + 1}" value="${bullionName}">
        <input name="gold_quantity_${i + 1}" value="${quantity}">
      </div>
    `).join('')}
    <p data-form-gold-output="loan_total"></p>
  `
  document.body.replaceChildren(form)
  return { form, pricingRows, quote }
}

function summaryFor(items, enquiryType = 'loan', withQuote = quote) {
  const estimates = items.map(([itemType, bullionName, quantity = 1]) => {
    const item = { itemType, bullionName, quantity: String(quantity) }
    return calculateEstimate(item, findPricingRow(pricingRows, item), quote.spotGbpPerGram)
  })
  return calculateGoldSummary(estimates, enquiryType, withQuote)
}

function loanTotalFor(items) {
  return summaryFor(items).loanTotal
}

function submit(instance) {
  return validateForm(instance, { showErrors: true, requirePrice: true })
}

// What Webflow reads: the flag its show-if/hide-if rules use, and the amount
// output inside the message.
function webflowSees(summary) {
  const form = document.createElement('form')
  form.innerHTML = '<p data-form-gold-output="loan_total"></p><span data-form-gold-output="loan_min"></span>'
  renderFormOutputs(form, summary)
  persistSummary(form, summary)
  return {
    belowMin: form.querySelector('input[name="gold_loan_below_min"]').value,
    loanMin: form.querySelector('[data-form-gold-output="loan_min"]').textContent,
  }
}

afterEach(() => {
  formConfig.gold.loanMin = LOAN_MIN
  document.body.innerHTML = ''
})

describe('gold £500 minimum loan', () => {
  it('blocks Continue on a loan under £500', () => {
    expect(submit(buildInstance('loan', [['bar', '1g_bar']])).ok).toBe(false)
  })

  it('flags a loan under £500 for Webflow and gives it the minimum amount', () => {
    expect(webflowSees(summaryFor([['bar', '1g_bar']]))).toEqual({ belowMin: 'true', loanMin: '£500' })
    expect(webflowSees(summaryFor([['coin', 'sovereign']]))).toEqual({ belowMin: '', loanMin: '£500' })
  })

  it('allows a loan exactly at the minimum and blocks £1 under it', () => {
    const items = [['coin', 'sovereign']]
    const total = loanTotalFor(items)

    formConfig.gold.loanMin = total
    expect(submit(buildInstance('loan', items)).ok).toBe(true)
    expect(webflowSees(summaryFor(items)).belowMin).toBe('')

    formConfig.gold.loanMin = total + 1
    expect(submit(buildInstance('loan', items)).ok).toBe(false)
    expect(webflowSees(summaryFor(items))).toEqual({ belowMin: 'true', loanMin: `£${total + 1}` })
  })

  it('does not block or flag selling', () => {
    expect(submit(buildInstance('Sell My Items', [['bar', '1g_bar']])).ok).toBe(true)
    expect(summaryFor([['bar', '1g_bar']], 'sell_my_items').belowLoanMin).toBe(false)
  })

  it('does not block a loan with an item that has no instant price', () => {
    expect(submit(buildInstance('loan', [['bar', '1g_bar'], ['coin', 'other']])).ok).toBe(true)
  })

  it('does not flag anything before the gold price has loaded', () => {
    expect(summaryFor([['bar', '1g_bar']], 'loan', null).belowLoanMin).toBe(false)
  })

  it('uses the same minimum as the pawn loan calculator', () => {
    expect(formConfig.gold.loanMin).toBe(formConfig.loan.min)
  })
})
