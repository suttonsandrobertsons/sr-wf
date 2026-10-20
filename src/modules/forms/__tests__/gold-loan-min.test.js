import { afterEach, describe, expect, it } from 'vitest'
import { goldCalculationTestHooks } from '../gold.js'
import { formConfig } from '../config.js'

const { validateForm, normalizePricingRows, findPricingRow, calculateEstimate, calculateGoldSummary } = goldCalculationTestHooks

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
    <div data-form-gold-output="validation_error"></div>
  `
  document.body.replaceChildren(form)
  return { form, pricingRows, quote }
}

function loanTotalFor(items) {
  const estimates = items.map(([itemType, bullionName, quantity = 1]) => {
    const item = { itemType, bullionName, quantity: String(quantity) }
    return calculateEstimate(item, findPricingRow(pricingRows, item), quote.spotGbpPerGram)
  })
  return calculateGoldSummary(estimates, 'loan', quote).loanTotal
}

function submit(instance) {
  return validateForm(instance, { showErrors: true, requirePrice: true })
}

function shownMessage(instance) {
  return instance.form.querySelector('[data-form-gold-output="validation_error"]').textContent
}

afterEach(() => {
  formConfig.gold.loanMin = LOAN_MIN
  document.body.innerHTML = ''
})

describe('gold £500 minimum loan', () => {
  it('blocks a loan under £500 and shows the message', () => {
    const instance = buildInstance('loan', [['bar', '1g_bar']])
    const validation = submit(instance)
    expect(validation.ok).toBe(false)
    expect(validation.message).toBe(MESSAGE)
    expect(shownMessage(instance)).toBe(MESSAGE)
  })

  it('allows a loan exactly at the minimum and blocks £1 under it', () => {
    const items = [['coin', 'sovereign']]
    const total = loanTotalFor(items)

    formConfig.gold.loanMin = total
    expect(submit(buildInstance('loan', items)).ok).toBe(true)

    formConfig.gold.loanMin = total + 1
    expect(submit(buildInstance('loan', items)).ok).toBe(false)
  })

  it('does not block selling', () => {
    const instance = buildInstance('Sell My Items', [['bar', '1g_bar']])
    expect(submit(instance).ok).toBe(true)
    expect(shownMessage(instance)).toBe('')
  })

  it('does not block a loan with an item that has no instant price', () => {
    const instance = buildInstance('loan', [['bar', '1g_bar'], ['coin', 'other']])
    expect(submit(instance).ok).toBe(true)
  })

  it('does not show the message while the customer is still filling in the form', () => {
    const instance = buildInstance('loan', [['bar', '1g_bar']])
    submit(instance)
    validateForm(instance)
    expect(shownMessage(instance)).toBe('')
  })
})
