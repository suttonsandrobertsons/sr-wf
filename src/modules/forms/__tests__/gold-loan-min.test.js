import { afterEach, describe, expect, it } from 'vitest'
import { goldCalculationTestHooks } from '../gold.js'
import { formConfig } from '../config.js'

const { validateForm, normalizePricingRows, findPricingRow, calculateEstimate, calculateGoldSummary, renderFormOutputs } = goldCalculationTestHooks

const MESSAGE = 'Minimum loan is £500. Please add more items.'
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

function loanBox(summary) {
  const form = document.createElement('form')
  form.innerHTML = '<p data-form-gold-output="loan_total"></p>'
  renderFormOutputs(form, summary)
  return form.querySelector('[data-form-gold-output="loan_total"]').textContent
}

afterEach(() => {
  formConfig.gold.loanMin = LOAN_MIN
  document.body.innerHTML = ''
})

describe('gold £500 minimum loan', () => {
  it('blocks Continue on a loan under £500', () => {
    const validation = submit(buildInstance('loan', [['bar', '1g_bar']]))
    expect(validation.ok).toBe(false)
    expect(validation.message).toBe(MESSAGE)
  })

  it('shows the message in place of the loan amount while the loan is under £500', () => {
    expect(loanBox(summaryFor([['bar', '1g_bar']]))).toBe(MESSAGE)
    expect(loanBox(summaryFor([['coin', 'sovereign']]))).toMatch(/^£\d/)
  })

  it('allows a loan exactly at the minimum and blocks £1 under it', () => {
    const items = [['coin', 'sovereign']]
    const total = loanTotalFor(items)

    formConfig.gold.loanMin = total
    expect(submit(buildInstance('loan', items)).ok).toBe(true)
    expect(loanBox(summaryFor(items))).toMatch(/^£\d/)

    formConfig.gold.loanMin = total + 1
    expect(submit(buildInstance('loan', items)).ok).toBe(false)
    expect(loanBox(summaryFor(items))).toBe(MESSAGE)
  })

  it('does not block or show the message when selling', () => {
    expect(submit(buildInstance('Sell My Items', [['bar', '1g_bar']])).ok).toBe(true)
    expect(summaryFor([['bar', '1g_bar']], 'sell_my_items').belowLoanMin).toBe(false)
  })

  it('does not block a loan with an item that has no instant price', () => {
    expect(submit(buildInstance('loan', [['bar', '1g_bar'], ['coin', 'other']])).ok).toBe(true)
  })

  it('does not show the message before the gold price has loaded', () => {
    expect(summaryFor([['bar', '1g_bar']], 'loan', null).belowLoanMin).toBe(false)
  })
})
