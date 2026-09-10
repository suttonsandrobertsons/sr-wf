import { beforeEach, describe, expect, it, afterEach } from 'vitest'
import { goldCalculationTestHooks } from '../gold.js'
import { formConfig } from '../config.js'
import { submittedFields } from "./helpers/webflow-submit.js"

const { normalizePricingRows, findPricingRow, calculateEstimate, calculateGoldSummary, persistSummary, persistItemSlotFields, getFieldWrappers, getItem, updateRepeaterState, getOfferRatio, calculatePurchaseValue, calculateLoanValue, getSpotOfferMultiplier, getRowOfferMultiplier, getDisplayValue, getPurityRatio, mround, roundWholePound, isManualRow, renderFormOutputs } = goldCalculationTestHooks

const pricingRows = normalizePricingRows([
  { itemType: 'Jewellery', label: '9ct jewellery', purityCarats: '9', weightGrams: '10' },
  { itemType: 'Jewellery', label: '18ct jewellery', purityCarats: '18', weightGrams: '10' },
  { itemType: 'Jewellery', label: '22ct jewellery', purityCarats: '22', weightGrams: '10' },
  { itemType: 'Bar', bullionName: '1g_bar', label: '1g Gold Bar', purityPercent: '99.99', weightGrams: '1' },
  { itemType: 'Bar', bullionName: 'pure_1g_bar', label: 'Pure 1g Gold Bar', purityPercent: '100', weightGrams: '1' },
  { itemType: 'Coin', bullionName: 'sovereign', label: 'Sovereign', purityPercent: '91.67', weightGrams: '7.99' },
])

const quote = {
  spotGbpPerGram: 98.16,
  updatedAt: 1781172000,
  source: 'test',
}

// The absolute money figures throughout this file were validated against the
// client's own pricing spreadsheet in July 2026, at a 2% spot discount and a
// flat 88% purchase rate. They are parity fixtures for the FORMULA and its
// MROUND-to-50p behaviour, so they are pinned to those rates rather than
// rewritten every time a rate moves — rewriting them would replace the
// client-validated numbers with our own arithmetic.
//
// The live rates are asserted separately, by name and by resulting figure, in
// "live configured rates (869eu8kr1)" at the end of this file. If you change a
// rate in config.js, that block is what should fail, not these.
const PINNED = {
  spotDiscountPercent: 2,
  purchaseToValuePercent: 88,
  purchaseToValuePercentByItemType: {},
}
const LIVE_RATES = { ...formConfig.gold }

beforeEach(() => {
  Object.assign(formConfig.gold, PINNED)
})

afterEach(() => {
  formConfig.gold.spotDiscountPercent = LIVE_RATES.spotDiscountPercent
  formConfig.gold.purchaseToValuePercent = LIVE_RATES.purchaseToValuePercent
  formConfig.gold.purchaseToValuePercentByItemType = LIVE_RATES.purchaseToValuePercentByItemType
})

function summaryFor(items, enquiryType = 'loan') {
  const estimates = items.map((item) => {
    return calculateEstimate(item, findPricingRow(pricingRows, item), quote.spotGbpPerGram)
  })
  return calculateGoldSummary(estimates, enquiryType, quote)
}

describe('gold calculator financials', () => {
  it('finds field wrappers and rewrites repeater radio names without relying on globals', () => {
    const form = document.createElement('form')
    form.innerHTML = `
      <div data-form-gold-item-list>
        <div data-form-gold-item>
          <div data-form-field="item_type">
            <input id="item_type_jewellery" type="radio" name="item_type" value="jewellery" checked>
            <label for="item_type_jewellery">Jewellery</label>
            <input id="item_type_coin" type="radio" name="item_type" value="coin">
            <label for="item_type_coin">Coin</label>
          </div>
          <div data-form-field="metal_type" data-form-show-if="item_type = jewellery">
            <input id="metal_type" name="metal_type" value="18">
            <label for="metal_type">Carat</label>
          </div>
          <div data-form-field="weight_grams" data-form-show-if="item_type = jewellery OR bullion_name = other">
            <input id="weight_grams" name="weight_grams" value="10">
            <label for="weight_grams">Weight</label>
          </div>
          <div data-form-field="bullion_name" data-form-show-if="item_type = coin">
            <select id="bullion_name" name="bullion_name">
              <option value=""></option>
              <option value="sovereign">Sovereign</option>
            </select>
            <label for="bullion_name">Coin type</label>
          </div>
          <div data-form-field="bullion_name" data-form-show-if="item_type = bar">
            <select id="bullion_name_bar" name="bullion_name">
              <option value=""></option>
              <option value="1g_bar">1g Bar</option>
            </select>
            <label for="bullion_name_bar">Bar type</label>
          </div>
          <div data-form-gold-quantity>
            <input id="quantity" name="quantity" value="2" data-form-gold-quantity-input>
            <label for="quantity">Quantity</label>
          </div>
        </div>
      </div>
    `

    const item = form.querySelector('[data-form-gold-item]')
    const wrappers = getFieldWrappers(item, 'item_type')

    expect(wrappers).toHaveLength(1)
    expect(() => updateRepeaterState({ form })).not.toThrow()
    expect(form.querySelector('[value="jewellery"]').name).toBe('gold_item_type_1')
    expect(form.querySelector('[value="jewellery"]').id).toBe('gold_item_type_1_jewellery')
    expect(form.querySelector('label').getAttribute('for')).toBe('gold_item_type_1_jewellery')
    expect(form.querySelector('[data-form-show-if]').getAttribute('data-form-show-if')).toBe('gold_item_type_1 = jewellery')
    expect(form.querySelector('[data-form-field="metal_type"] input').name).toBe('gold_metal_type_1')
    expect(form.querySelector('[data-form-field="metal_type"] input').id).toBe('gold_metal_type_1')
    expect(form.querySelector('label[for="gold_metal_type_1"]')).toBeTruthy()
    expect(form.querySelector('[data-form-field="weight_grams"]').getAttribute('data-form-show-if')).toBe('gold_item_type_1 = jewellery OR gold_bullion_name_1_coin = other OR gold_bullion_name_1_bar = other')
    expect(form.querySelector('[data-form-field="weight_grams"] input').name).toBe('gold_weight_grams_1')
    expect(form.querySelector('[data-form-gold-quantity-input]').name).toBe('gold_quantity_1')
    expect(Array.from(form.querySelectorAll('[data-form-field="bullion_name"] select')).map((select) => select.name)).toEqual([
      'gold_bullion_name_1_coin',
      'gold_bullion_name_1_bar',
    ])
    expect(getItem(form, item)).toMatchObject({
      itemType: 'jewellery',
      metalType: '18',
      quantity: '2',
      weightGrams: '10',
    })
  })

  it('keeps repeated live controls uniquely named and labelled across multiple rows', () => {
    const form = document.createElement('form')
    form.innerHTML = `
      <div data-form-gold-item-list>
        ${[1, 2].map(() => `
          <div data-form-gold-item>
            <div data-form-field="item_type">
              <input id="item_type_jewellery" type="radio" name="item_type" value="jewellery" checked>
              <label for="item_type_jewellery">Jewellery</label>
              <input id="item_type_bar" type="radio" name="item_type" value="bar">
              <label for="item_type_bar">Bar</label>
            </div>
            <div data-form-field="metal_type" data-form-show-if="item_type = jewellery">
              <select id="metal_type" name="metal_type">
                <option value=""></option>
                <option id="9" value="9">9ct</option>
                <option id="18" value="18" selected>18ct</option>
              </select>
              <label for="metal_type">Carat</label>
            </div>
            <div data-form-field="weight_grams" data-form-show-if="item_type = jewellery OR bullion_name = other">
              <input id="weight_grams" name="weight_grams" value="10">
              <label for="weight_grams">Weight</label>
            </div>
            <div data-form-field="bullion_name" data-form-show-if="item_type = bar">
              <select id="bullion_name" name="bullion_name">
                <option value=""></option>
                <option id="1g_bar" value="1g_bar">1g Bar</option>
              </select>
              <label for="bullion_name">Bar type</label>
            </div>
            <div data-form-gold-quantity>
              <input id="quantity" name="quantity" value="1" data-form-gold-quantity-input>
              <label for="quantity">Quantity</label>
            </div>
          </div>
        `).join('')}
      </div>
    `

    updateRepeaterState({ form })

    const ids = Array.from(form.querySelectorAll('[id]')).map((el) => el.id).filter(Boolean)
    const names = Array.from(form.querySelectorAll('[data-form-gold-item] input, [data-form-gold-item] select'))
      .map((el) => el.name)
      .filter(Boolean)

    expect(ids.length).toBe(new Set(ids).size)
    expect(names.length).toBe(new Set(names).size + 2) // radio groups intentionally share one name per row
    expect(names).not.toContain('item_type')
    expect(names).not.toContain('metal_type')
    expect(names).not.toContain('weight_grams')
    expect(names).not.toContain('bullion_name')
    expect(names).not.toContain('quantity')
    expect(names).toEqual(expect.arrayContaining([
      'gold_item_type_1',
      'gold_metal_type_1',
      'gold_weight_grams_1',
      'gold_bullion_name_1',
      'gold_quantity_1',
      'gold_item_type_2',
      'gold_metal_type_2',
      'gold_weight_grams_2',
      'gold_bullion_name_2',
      'gold_quantity_2',
    ]))
    expect(form.querySelector('[data-form-gold-item-index="2"] [data-form-field="weight_grams"]').getAttribute('data-form-show-if')).toBe('gold_item_type_2 = jewellery OR gold_bullion_name_2 = other')
    expect(form.querySelector('label[for="gold_weight_grams_2"]')).toBeTruthy()
  })

  it('calculates 9ct jewellery using spreadsheet-equivalent half-pound pricing rounds', () => {
    const row = findPricingRow(pricingRows, {
      itemType: 'jewellery',
      metalType: '9',
      weightGrams: '10',
      quantity: '1',
    })

    expect(calculateEstimate({
      itemType: 'jewellery',
      metalType: '9',
      weightGrams: '10',
      quantity: '1',
    }, row, quote.spotGbpPerGram)).toMatchObject({
      spotValue: 368.1,
      purchaseValue: 315,
      loanValue: 270,
      manual: false,
    })
  })

  it('calculates 18ct jewellery from entered weight, selected carat, and spreadsheet rounds', () => {
    const row = findPricingRow(pricingRows, {
      itemType: 'jewellery',
      metalType: '18',
      weightGrams: '10',
      quantity: '1',
    })

    expect(calculateEstimate({
      itemType: 'jewellery',
      metalType: '18',
      weightGrams: '10',
      quantity: '1',
    }, row, quote.spotGbpPerGram)).toMatchObject({
      spotValue: 736.2,
      purchaseValue: 635,
      loanValue: 540,
      manual: false,
    })
  })

  it('calculates jewellery quantity from rounded per-unit values', () => {
    const summary = summaryFor([
      { itemType: 'jewellery', metalType: '22', weightGrams: '10', quantity: '2' },
    ])

    expect(summary).toMatchObject({
      spotTotal: 1800,
      purchaseTotal: 1550,
      loanTotal: 1320,
      indicativeValue: 1320,
      monthlyInterest: 86,
      totalInterest: 516,
      repaymentAmount: 1836,
    })
  })

  it('uses purchase total as the indicative value for outright sale enquiries', () => {
    const summary = summaryFor([
      { itemType: 'jewellery', metalType: '22', weightGrams: '10', quantity: '2' },
    ], 'sell')

    expect(summary).toMatchObject({
      purchaseTotal: 1550,
      loanTotal: 1320,
      indicativeValue: 1550,
    })
  })

  it('calculates fixed-weight bars with quantity', () => {
    const summary = summaryFor([
      { itemType: 'bar', bullionName: '1g_bar', quantity: '3' },
    ])

    expect(summary).toMatchObject({
      spotTotal: 294,
      purchaseTotal: 254,
      loanTotal: 216,
      monthlyInterest: 14,
      totalInterest: 84,
      repaymentAmount: 300,
      loanInterestRate: 6.5,
    })
  })

  it('calculates sovereign coins from pricing database purity and weight', () => {
    const summary = summaryFor([
      { itemType: 'coin', bullionName: 'sovereign', quantity: '2' },
    ])

    expect(summary).toMatchObject({
      spotTotal: 1438,
      purchaseTotal: 1240,
      loanTotal: 1057,
      monthlyInterest: 69,
      totalInterest: 414,
      repaymentAmount: 1471,
    })
  })

  it('rounds purchase values to nearest 50p at spreadsheet boundaries', () => {
    const row = findPricingRow(pricingRows, { itemType: 'bar', bullionName: 'pure_1g_bar', quantity: '1' })
    const item = { itemType: 'bar', bullionName: 'pure_1g_bar', quantity: '1' }

    expect(calculateEstimate(item, row, 10.24 / (0.88 * 0.98)).purchaseValue).toBe(10)
    expect(calculateEstimate(item, row, 10.25 / (0.88 * 0.98)).purchaseValue).toBe(10.5)
    expect(calculateEstimate(item, row, 10.5 / (0.88 * 0.98)).purchaseValue).toBe(10.5)
    expect(calculateEstimate(item, row, 10.74 / (0.88 * 0.98)).purchaseValue).toBe(10.5)
    expect(calculateEstimate(item, row, 10.75 / (0.88 * 0.98)).purchaseValue).toBe(11)
  })

  it('rounds loan values to nearest 50p at spreadsheet boundaries', () => {
    const row = findPricingRow(pricingRows, { itemType: 'bar', bullionName: 'pure_1g_bar', quantity: '1' })
    const item = { itemType: 'bar', bullionName: 'pure_1g_bar', quantity: '1' }

    expect(calculateEstimate(item, row, 10.24 / (0.75 * 0.98)).loanValue).toBe(10)
    expect(calculateEstimate(item, row, 10.25 / (0.75 * 0.98)).loanValue).toBe(10.5)
    expect(calculateEstimate(item, row, 10.5 / (0.75 * 0.98)).loanValue).toBe(10.5)
    expect(calculateEstimate(item, row, 10.74 / (0.75 * 0.98)).loanValue).toBe(10.5)
    expect(calculateEstimate(item, row, 10.75 / (0.75 * 0.98)).loanValue).toBe(11)
  })

  it('allows Other and Unsure bullion selections as manual quote items', () => {
    const other = findPricingRow(pricingRows, { itemType: 'bar', bullionName: 'Other', quantity: '1' })
    const unsure = findPricingRow(pricingRows, { itemType: 'coin', bullionName: 'Unsure', quantity: '1' })

    expect(other).toMatchObject({ itemType: 'bar', bullionName: 'other', label: 'Other' })
    expect(unsure).toMatchObject({ itemType: 'coin', bullionName: 'unsure', label: 'Unsure' })

    const summary = summaryFor([
      { itemType: 'bar', bullionName: 'Other', quantity: '1' },
      { itemType: 'coin', bullionName: 'Unsure', quantity: '1' },
    ])

    expect(summary).toMatchObject({
      itemCount: 2,
      manualCount: 2,
      hasManualItems: true,
      spotTotal: 0,
      purchaseTotal: 0,
      loanTotal: 0,
      loanInterestRate: 0,
      loanApr: 0,
      monthlyInterest: 0,
      totalInterest: 0,
      repaymentAmount: 0,
      isAboveMax: false,
    })
    expect(summary.items.every((item) => item.manual)).toBe(true)
  })

  it('persists fixed item slot fields for Zapier through five gold items', () => {
    const form = document.createElement('form')
    form.innerHTML = `
      <input type="radio" name="gold_item_type_1" value="jewellery" checked>
      <input type="radio" name="gold_item_type_1" value="coin">
      <input type="radio" name="gold_item_type_1" value="bar">
    `
    const summary = summaryFor([
      { itemType: 'jewellery', metalType: '9', weightGrams: '1', quantity: '2' },
      { itemType: 'bar', bullionName: '1g_bar', quantity: '3' },
    ], 'unsure')

    persistItemSlotFields(form, summary)

    expect(form.querySelector('[name="gold_item_type_1"][value="jewellery"]').checked).toBe(true)
    expect(form.querySelector('[name="gold_item_type_1"][value="coin"]')).toBeTruthy()
    expect(form.querySelector('[name="gold_item_type_1"][value="bar"]')).toBeTruthy()

    expect(form.querySelector('[name="gold_item_1_type"]').value).toBe('Jewellery')
    // "9ct Gold" is Zoho's own Item_N_Metal option; the bare "9" matched none.
    expect(form.querySelector('[name="gold_item_1_metal_type"]').value).toBe('9ct Gold')
    expect(form.querySelector('[name="gold_item_1_weight_grams"]').value).toBe('1')
    expect(form.querySelector('[name="gold_item_1_quantity"]').value).toBe('2')
    expect(form.querySelector('[name="gold_item_1_label"]').value).toBe('9ct jewellery')
    expect(form.querySelector('[name="gold_item_1_purchase_value"]').value).toBe('63')
    expect(form.querySelector('[name="gold_item_1_loan_value"]').value).toBe('54')
    // Enquiry is 'unsure' → item amount is the higher of purchase/loan, rounded
    // to whole £; asset type is a literal "Gold" for a filled slot.
    expect(form.querySelector('[name="gold_item_1_amount"]').value).toBe('63')
    expect(form.querySelector('[name="gold_item_1_asset_type"]').value).toBe('Gold')

    expect(form.querySelector('[name="gold_item_2_type"]').value).toBe('Bar')
    expect(form.querySelector('[name="gold_item_2_bullion_name"]').value).toBe('1g_bar')
    expect(form.querySelector('[name="gold_item_2_quantity"]').value).toBe('3')
    // Per-item money values are now whole £ (one precision): 253.5 → 254.
    expect(form.querySelector('[name="gold_item_2_purchase_value"]').value).toBe('254')
    expect(form.querySelector('[name="gold_item_2_loan_value"]').value).toBe('216')
    expect(form.querySelector('[name="gold_item_2_amount"]').value).toBe('254')
    expect(form.querySelector('[name="gold_item_2_asset_type"]').value).toBe('Gold')

    expect(form.querySelector('[name="gold_item_5_type"]').value).toBe('')
    expect(form.querySelector('[name="gold_item_5_purchase_value"]').value).toBe('')
    // Empty slots emit blank amount and asset type (no phantom Zoho rows).
    expect(form.querySelector('[name="gold_item_5_amount"]').value).toBe('')
    expect(form.querySelector('[name="gold_item_5_asset_type"]').value).toBe('')
    const typeSlotFields = Array.from(form.querySelectorAll('input[type="hidden"]'))
      .filter((field) => /^gold_item_\d+_type$/.test(field.name))
    expect(typeSlotFields.length).toBe(5)
  })

  it('submits stable flattened fields for loan, sell, unsure, priced, manual, and empty gold slots', () => {
    const scenarios = [
      {
        enquiryType: 'loan',
        items: [
          { itemType: 'jewellery', metalType: '18', weightGrams: '2', quantity: '1' },
        ],
        expectedIndicativeValue: '108',
      },
      {
        enquiryType: 'sell',
        items: [
          { itemType: 'coin', bullionName: 'sovereign', quantity: '1' },
        ],
        expectedIndicativeValue: '620',
      },
      {
        enquiryType: 'unsure',
        items: [
          { itemType: 'bar', bullionName: '1g_bar', quantity: '1' },
          { itemType: 'coin', bullionName: 'Unsure', quantity: '1' },
        ],
        // Amount fields are rounded to whole £ at emit: 84.5 → 85.
        expectedIndicativeValue: '85',
      },
      {
        enquiryType: 'loan',
        items: [
          { itemType: 'jewellery', metalType: '9', weightGrams: '1', quantity: '1' },
          { itemType: 'jewellery', metalType: '18', weightGrams: '1', quantity: '1' },
          { itemType: 'bar', bullionName: '1g_bar', quantity: '1' },
          { itemType: 'coin', bullionName: 'sovereign', quantity: '1' },
          { itemType: 'bar', bullionName: 'Other', quantity: '1' },
        ],
        // 681.5 → 682 after whole-£ rounding at emit.
        expectedIndicativeValue: '682',
      },
    ]

    scenarios.forEach(({ enquiryType, items, expectedIndicativeValue }) => {
      const form = document.createElement('form')
      form.innerHTML = `
        <input name="first_name" value="Alex">
        <input name="email" value="alex@example.com">
        <input type="radio" name="enquiry_type" value="${enquiryType}" checked>
      `
      const summary = summaryFor(items, enquiryType)

      persistSummary(form, summary)

      const submitted = submittedFields(form)

      expect(submitted.gold_item_count).toBe(String(items.length))
      expect(submitted.gold_indicative_value).toBe(expectedIndicativeValue)
      // gold_total is the single enquiry-aware total for Zoho — aliases the
      // indicative value.
      expect(submitted.gold_total).toBe(expectedIndicativeValue)
      expect(submitted.gold_items_json).toBeUndefined()
      expect(submitted.gold_calculation_audit_json).toBeUndefined()
      expect(submitted.gold_purchase_formula).toBeUndefined()
      expect(submitted.gold_loan_formula).toBeUndefined()
      expect(submitted.gold_rounding_rule).toBeUndefined()

      for (let index = 1; index <= 5; index += 1) {
        expect(submitted).toHaveProperty(`gold_item_${index}_type`)
        expect(submitted).toHaveProperty(`gold_item_${index}_metal_type`)
        expect(submitted).toHaveProperty(`gold_item_${index}_weight_grams`)
        expect(submitted).toHaveProperty(`gold_item_${index}_quantity`)
        expect(submitted).toHaveProperty(`gold_item_${index}_bullion_name`)
        expect(submitted).toHaveProperty(`gold_item_${index}_label`)
        expect(submitted).toHaveProperty(`gold_item_${index}_spot_value`)
        expect(submitted).toHaveProperty(`gold_item_${index}_purchase_value`)
        expect(submitted).toHaveProperty(`gold_item_${index}_loan_value`)
        expect(submitted).toHaveProperty(`gold_item_${index}_amount`)
        expect(submitted).toHaveProperty(`gold_item_${index}_asset_type`)
        expect(submitted).toHaveProperty(`gold_item_${index}_manual`)
      }

      // Filled slots carry the literal "Gold" asset type; empty slots are blank.
      for (let index = 1; index <= items.length; index += 1) {
        expect(submitted[`gold_item_${index}_asset_type`]).toBe('Gold')
      }

      const emptySlot = items.length + 1
      if (emptySlot <= 5) {
        expect(submitted[`gold_item_${emptySlot}_type`]).toBe('')
        expect(submitted[`gold_item_${emptySlot}_purchase_value`]).toBe('')
        expect(submitted[`gold_item_${emptySlot}_amount`]).toBe('')
        expect(submitted[`gold_item_${emptySlot}_asset_type`]).toBe('')
      }
    })
  })

  it('emits Zoho amount fields as whole £ and formats interest (#1, #4)', () => {
    const form = document.createElement('form')
    form.innerHTML = `<input type="radio" name="enquiry_type" value="loan" checked>`
    // A jewellery item chosen to produce non-whole totals so rounding is visible.
    const summary = summaryFor([
      { itemType: 'jewellery', metalType: '18', weightGrams: '15', quantity: '1' },
    ], 'loan')

    persistSummary(form, summary)
    const submitted = submittedFields(form)

    for (const field of ['gold_purchase_total', 'gold_loan_total', 'gold_indicative_value', 'gold_total', 'gold_monthly_interest']) {
      expect(submitted[field], field).toMatch(/^\d+$/)
      expect(submitted[field], field).toBe(String(Math.round(Number(submitted[field]))))
    }
    expect(submitted.gold_loan_total).toBe(String(Math.round(summary.loanTotal)))
    expect(submitted.gold_monthly_interest).toBe(String(Math.round(summary.monthlyInterest)))
    expect(submitted.gold_interest_rate).toMatch(/^\d+\.\d$/)
    expect(submitted.gold_interest_rate).toBe(Number(summary.loanInterestRate).toFixed(1))
  })

  it('per-item amounts always add up to gold_total, across multiple .5-ending items', () => {
    const form = document.createElement('form')
    form.innerHTML = `<input type="radio" name="enquiry_type" value="loan" checked>`
    // Three separate 9ct items whose per-item loan value ends in .5 — the case
    // where independent whole-£ rounding used to drift from the rounded sum.
    //
    // 1.5g, not 10g. At 10g the loan value is a whole £270 and this test
    // passes without exercising anything; it was deleted on 9 Sep 2026 and
    // restored on 10 Sep with a fixture that still lands on .5. The
    // precondition below is asserted so it cannot go quiet again.
    const items = [1, 2, 3].map(() => (
      { itemType: 'jewellery', metalType: '9', weightGrams: '1.5', quantity: '1' }
    ))
    const summary = summaryFor(items, 'loan')

    summary.items.forEach((item) => {
      expect(item.loanValue % 1).toBe(0.5)
    })

    persistSummary(form, summary)
    const submitted = submittedFields(form)

    const itemAmounts = [1, 2, 3].map((i) => Number(submitted[`gold_item_${i}_amount`]))
    const sumOfItems = itemAmounts.reduce((a, b) => a + b, 0)
    // The three per-item amounts foot exactly to the total — no ±£1 drift.
    expect(sumOfItems).toBe(Number(submitted.gold_total))
    expect(Number(submitted.gold_total)).toBe(Number(submitted.gold_loan_total))
    itemAmounts.forEach((v) => expect(String(v)).toMatch(/^\d+$/))
  })


  it('shows the purchase figure for "Sell My Items" even when the loan rate is higher', () => {
    // The live radio submits "Sell My Items", which normalizeSlug turns into
    // "sell_my_items". Until 10 Sep 2026 getDisplayValue only tested for
    // "sell", so sell leads fell through to Math.max(purchase, loan). That
    // gave the right answer only because purchase (86-88%) beats loan (75%).
    //
    // This test inverts the rates so the fallback would give the WRONG answer,
    // which is what makes it a real assertion rather than a tautology.
    // Restored here, not in afterEach: beforeEach only pins the three rates in
    // PINNED, so leaving this set leaks into every later test in the file.
    const realLoanRate = formConfig.gold.loanToValuePercent
    try {
      formConfig.gold.loanToValuePercent = 95

      const item = { itemType: 'jewellery', metalType: '18', weightGrams: '10', quantity: '1' }
      const estimate = calculateEstimate(item, findPricingRow(pricingRows, item), quote.spotGbpPerGram)

      expect(estimate.loanValue).toBeGreaterThan(estimate.purchaseValue)
      expect(getDisplayValue(estimate, 'sell_my_items')).toBe(estimate.purchaseValue)
      expect(getDisplayValue(estimate, 'loan')).toBe(estimate.loanValue)
      // Unanswered still shows the better of the two.
      expect(getDisplayValue(estimate, '')).toBe(estimate.loanValue)
    } finally {
      formConfig.gold.loanToValuePercent = realLoanRate
    }
  })

  it('interest fields reconcile: monthly × term = total, loan + total = repayment', () => {
    const form = document.createElement('form')
    form.innerHTML = `<input type="radio" name="enquiry_type" value="loan" checked>`
    const summary = summaryFor([
      { itemType: 'coin', bullionName: 'sovereign', quantity: '2' },
    ], 'loan')

    persistSummary(form, summary)
    const s = submittedFields(form)
    const n = (k) => Number(s[k])

    for (const f of ['gold_monthly_interest', 'gold_total_interest', 'gold_repayment_amount', 'gold_loan_total']) {
      expect(s[f], f).toMatch(/^\d+$/)
    }
    expect(n('gold_monthly_interest') * summary.loanTermMonths).toBe(n('gold_total_interest'))
    expect(n('gold_loan_total') + n('gold_total_interest')).toBe(n('gold_repayment_amount'))
  })

  it('renders interest rate and apr with decimals, trimming trailing zeros', () => {
    const form = document.createElement('form')
    form.innerHTML = `
      <span data-form-gold-output="interest_rate"></span>
      <span data-form-gold-output="apr"></span>
    `
    renderFormOutputs(form, {
      status: 'ready',
      loanInterestRate: 6.5,
      loanApr: 93.21,
      isAboveMax: false,
    })

    expect(form.querySelector('[data-form-gold-output="interest_rate"]').textContent).toBe('6.5')
    expect(form.querySelector('[data-form-gold-output="apr"]').textContent).toBe('93.21')
  })

  it('renders whole-number rates without spurious decimals', () => {
    const form = document.createElement('form')
    form.innerHTML = `<span data-form-gold-output="interest_rate"></span>`
    renderFormOutputs(form, {
      status: 'ready',
      loanInterestRate: 6,
      loanApr: 0,
      isAboveMax: false,
    })

    expect(form.querySelector('[data-form-gold-output="interest_rate"]').textContent).toBe('6')
  })

  it('routes coin and bar rows with missing row weight to manual', () => {
    expect(isManualRow({ itemType: 'coin', purityPercent: 91.67, weightGrams: NaN })).toBe(true)
    expect(isManualRow({ itemType: 'bar', purityPercent: 99.99, weightGrams: 0 })).toBe(true)
    expect(isManualRow({ itemType: 'bar', purityPercent: 99.99, weightGrams: 1 })).toBe(false)
  })

  it('keeps jewellery rows priceable without a row weight (user supplies weight)', () => {
    expect(isManualRow({ itemType: 'jewellery', purityCarats: 18, weightGrams: NaN })).toBe(false)
  })

  it('returns a structured object (never a bare NaN) so callers can read purchase fields', () => {
    const result = calculatePurchaseValue('bar', 1, 0.9999, 1, NaN)
    expect(typeof result).toBe('object')
    expect(result).not.toBeNull()
    expect(result).toHaveProperty('purchaseValue')
    expect(result).toHaveProperty('purchasePerUnit')
    expect(result).toHaveProperty('purchaseValueRaw')
    expect(Number.isFinite(result.purchaseValueRaw)).toBe(false)
  })

  it('treats a configured percent of exactly 1 as 100 percent, not a ratio', () => {
    expect(getOfferRatio('purchase')).toBeCloseTo(0.88, 5)
  })

})

describe('getItem reads collapsed single-submit branch names (multi-item bullion regression)', () => {
  // Repro of the live bug: on a multi-item gold form, the shared single-submit
  // dedup renames item 2+'s bullion <select> to `_disabled_bullion_name`. The
  // select stays visible with the user's value, but its name no longer matches
  // the `gold_bullion_name_2_` indexed prefix. getItem must still read it, else
  // submit falsely errors "Choose the coin or bar." and the persisted
  // gold_item_2_bullion_name field goes empty.
  function buildItem2WithCollapsedBullion() {
    const form = document.createElement('form')
    form.setAttribute('data-form', 'gold')
    form.innerHTML = `
      <div data-form-gold-item-list>
        <div data-form-gold-item data-form-gold-item-index="2">
          <div data-form-field="item_type">
            <input type="radio" name="gold_item_type_2" value="coin" checked>
            <input type="radio" name="gold_item_type_2" value="bar">
          </div>
          <!-- coin branch: visible/active, but name collapsed by single-submit -->
          <div data-form-field="bullion_name" data-form-show-if="gold_item_type_2 = coin"
               data-form-state="active loaded filled">
            <select name="_disabled_bullion_name" data-form-submit-original-name="bullion_name">
              <option value="1_oz_gold_britannia" selected>1 Oz Gold Britannia</option>
            </select>
          </div>
          <!-- bar branch: condition-hidden, also collapsed, must NOT be read -->
          <div data-form-field="bullion_name" data-form-show-if="gold_item_type_2 = bar"
               data-form-state="condition-hidden">
            <select name="_disabled_bullion_name" data-form-submit-original-name="bullion_name">
              <option value="1g_bar" selected>1g Gold Bar</option>
            </select>
          </div>
        </div>
      </div>
    `
    return { form, itemEl: form.querySelector('[data-form-gold-item-index="2"]') }
  }

  it('reads item 2 bullion from the active branch despite the _disabled_ name', () => {
    const { form, itemEl } = buildItem2WithCollapsedBullion()
    const item = getItem(form, itemEl)
    expect(item.bullionName).toBe('1_oz_gold_britannia')
  })

  it('ignores the condition-hidden bar branch (reads coin, not bar)', () => {
    const { form, itemEl } = buildItem2WithCollapsedBullion()
    const item = getItem(form, itemEl)
    expect(item.bullionName).not.toBe('1g_bar')
  })

  it('still prefers the properly indexed name when it is present (no regression for item 1)', () => {
    const form = document.createElement('form')
    form.setAttribute('data-form', 'gold')
    form.innerHTML = `
      <div data-form-gold-item-list>
        <div data-form-gold-item data-form-gold-item-index="1">
          <div data-form-field="item_type">
            <input type="radio" name="gold_item_type_1" value="coin" checked>
          </div>
          <div data-form-field="bullion_name" data-form-show-if="gold_item_type_1 = coin"
               data-form-state="active loaded filled">
            <select name="bullion_name">
              <option value="gold_sovereign" selected>Gold Sovereign</option>
            </select>
          </div>
        </div>
      </div>
    `
    const itemEl = form.querySelector('[data-form-gold-item-index="1"]')
    expect(getItem(form, itemEl).bullionName).toBe('gold_sovereign')
  })
})

describe('item type is emitted in Zoho-picklist case, not the internal slug (#5)', () => {
  // Internal item type stays a lowercase slug (load-bearing for condition rules
  // and pricing lookup); only the emitted gold_item_N_type is display-cased.
  function emitType(item) {
    const form = document.createElement('form')
    const summary = summaryFor([item], 'sell')
    persistItemSlotFields(form, summary)
    return form.querySelector('[name="gold_item_1_type"]').value
  }

  it('maps coin -> Coin', () => {
    expect(emitType({ itemType: 'coin', bullionName: 'sovereign', quantity: '1' })).toBe('Coin')
  })

  it('maps bar -> Bar', () => {
    expect(emitType({ itemType: 'bar', bullionName: '1g_bar', quantity: '1' })).toBe('Bar')
  })

  it('maps jewellery -> Jewellery', () => {
    expect(emitType({ itemType: 'jewellery', metalType: '18', weightGrams: '10', quantity: '1' })).toBe('Jewellery')
  })
})

describe('2% spot discount — offers only, not the displayed spot value', () => {
  // spotDiscountPercent (config.gold) trims the spot before the purchase/loan
  // ratios apply; the displayed spotValue keeps the raw market spot.
  it('applies the discount to purchase/loan but leaves spotValue raw', () => {
    const row = findPricingRow(pricingRows, { itemType: 'bar', bullionName: 'pure_1g_bar', quantity: '1' })
    const item = { itemType: 'bar', bullionName: 'pure_1g_bar', quantity: '1' }
    const est = calculateEstimate(item, row, 100) // spot £100/g, 1g @ 100% purity

    expect(est.spotValue).toBe(100)      // raw: 1 * 1 * 1 * 100 (no 2% here)
    expect(est.purchaseValue).toBe(86)   // mround(100 * 0.98 * 0.88, 0.5) = 86
    expect(est.loanValue).toBe(73.5)     // mround(100 * 0.98 * 0.75, 0.5) = 73.5
  })
})

// ---------------------------------------------------------------------------
// Comprehensive pricing coverage — primitives, ratios, formulas, rounding
// model, rate bands, interest reconciliation, aggregation and emission.
// ---------------------------------------------------------------------------

// A synthetic estimate lets tests drive calculateGoldSummary with exact
// purchase/loan values (bypassing the pricing maths) so band boundaries and
// footing can be asserted precisely.
function synthEstimate({ purchaseValue = 0, loanValue = 0, spotValue = 0, manual = false, itemType = 'coin', quantity = 1 } = {}) {
  return {
    label: 'synthetic', itemType, bullionName: '', metalType: '',
    quantity, weightGrams: 1, purityRatio: 0.9,
    spotValue, purchaseValue, loanValue, manual, calculation: {},
  }
}
const summaryOf = (estimates, enquiryType = 'loan') =>
  calculateGoldSummary(estimates, enquiryType, quote, estimates)

describe('rounding primitives', () => {
  it('mround snaps to the nearest £0.50, half-up', () => {
    expect(mround(0.24, 0.5)).toBe(0)
    expect(mround(0.25, 0.5)).toBe(0.5)
    expect(mround(0.74, 0.5)).toBe(0.5)
    expect(mround(0.75, 0.5)).toBe(1)
    expect(mround(10.24, 0.5)).toBe(10)
    expect(mround(10.25, 0.5)).toBe(10.5)
    expect(mround(660, 0.5)).toBe(660)
  })

  it('mround honours a custom step and coerces numeric strings', () => {
    expect(mround(97, 5)).toBe(95)
    expect(mround(98, 5)).toBe(100)
    expect(mround('12.3', 0.5)).toBe(12.5)
  })

  it('mround returns NaN for a zero step or non-finite input', () => {
    expect(mround(5, 0)).toBeNaN()
    expect(mround(NaN, 0.5)).toBeNaN()
  })

  it('roundWholePound rounds to whole £ half-up, and coerces junk to 0', () => {
    expect(roundWholePound(816.5)).toBe(817)
    expect(roundWholePound(816.49)).toBe(816)
    expect(roundWholePound(0.5)).toBe(1)
    expect(roundWholePound(1.5)).toBe(2)
    expect(roundWholePound(817)).toBe(817)
    expect(roundWholePound('123.4')).toBe(123)
    expect(roundWholePound(NaN)).toBe(0)
    expect(roundWholePound('not a number')).toBe(0)
    expect(roundWholePound(undefined)).toBe(0)
  })
})

describe('spot discount (getSpotOfferMultiplier)', () => {
  const original = formConfig.gold.spotDiscountPercent
  afterEach(() => { formConfig.gold.spotDiscountPercent = original })

  it('is 0.98 for the configured 2% discount', () => {
    formConfig.gold.spotDiscountPercent = 2
    expect(getSpotOfferMultiplier()).toBeCloseTo(0.98, 10)
  })

  it('is 0.95 for a 5% discount', () => {
    formConfig.gold.spotDiscountPercent = 5
    expect(getSpotOfferMultiplier()).toBeCloseTo(0.95, 10)
  })

  it('falls back to 1 (no adjustment) for missing / zero / negative / >=100 config', () => {
    for (const bad of [undefined, null, 0, -5, 100, 150, 'abc']) {
      formConfig.gold.spotDiscountPercent = bad
      expect(getSpotOfferMultiplier(), String(bad)).toBe(1)
    }
  })
})

describe('offer ratios (getOfferRatio)', () => {
  it('reads purchase 0.88 and loan 0.75 from config', () => {
    expect(getOfferRatio('purchase')).toBeCloseTo(0.88, 10)
    expect(getOfferRatio('loan')).toBeCloseTo(0.75, 10)
  })
})

describe('purchase & loan formulas', () => {
  // spot passed here is the OFFER spot (discount already applied by the caller).
  it('jewellery purchase double-rounds: £/gram to 50p, then per-unit to 50p', () => {
    const p = calculatePurchaseValue('jewellery', 10, 0.75, 1, 100)
    expect(p.purchasePerGram).toBe(66)   // mround(0.75*100*0.88, .5)
    expect(p.purchasePerUnit).toBe(660)  // mround(10*66, .5)
    expect(p.purchaseValue).toBe(660)
  })

  it('jewellery purchase £/gram actually snaps to 50p', () => {
    const p = calculatePurchaseValue('jewellery', 10, 0.9167, 1, 100)
    expect(p.purchasePerGram).toBe(80.5) // mround(0.9167*100*0.88=80.67, .5)
    expect(p.purchaseValue).toBe(805)    // mround(10*80.5, .5)
  })

  it('jewellery loan is symmetric with purchase — £/gram rounded then per-unit', () => {
    const l = calculateLoanValue('jewellery', 10, 0.75, 1, 100)
    expect(l.loanPerGram).toBe(56.5)  // mround(0.75*100*0.75=56.25, .5)
    expect(l.loanPerUnit).toBe(565)   // mround(10*56.5, .5)
    expect(l.loanValue).toBe(565)
    // A single-rounding loan would have been mround(562.5,.5)=562.5 — the
    // symmetric per-gram rounding deliberately changes the result.
    expect(l.loanValue).not.toBe(562.5)
  })

  it('coin/bar round only once, per-unit', () => {
    const p = calculatePurchaseValue('coin', 7.99, 0.9167, 1, 100)
    expect(p.purchasePerGram).toBeNaN()   // no per-gram step for bullion
    expect(p.purchaseValue).toBe(644.5)   // mround(7.99*0.9167*100*0.88, .5)
    const l = calculateLoanValue('coin', 7.99, 0.9167, 1, 100)
    expect(l.loanPerGram).toBeNaN()
    expect(l.loanValue).toBe(549.5)       // mround(7.99*0.9167*100*0.75, .5)
  })

  it('multiplies by quantity after rounding the per-unit value', () => {
    const p = calculatePurchaseValue('coin', 7.99, 0.9167, 3, 100)
    expect(p.purchaseValue).toBe(1933.5)  // 3 * 644.5
  })

  it('returns NaN values when the offer ratio is non-positive', () => {
    const original = formConfig.gold.purchaseToValuePercent
    try {
      formConfig.gold.purchaseToValuePercent = 0
      const p = calculatePurchaseValue('coin', 7.99, 0.9167, 1, 100)
      expect(p.purchaseValue).toBeNaN()
    } finally {
      formConfig.gold.purchaseToValuePercent = original
    }
  })
})

describe('getDisplayValue (enquiry-aware per-item amount)', () => {
  const est = synthEstimate({ purchaseValue: 100, loanValue: 80 })
  it('loan → loan value', () => expect(getDisplayValue(est, 'loan')).toBe(80))
  it('sell → purchase value', () => expect(getDisplayValue(est, 'sell')).toBe(100))
  it('consign → purchase value', () => expect(getDisplayValue(est, 'consign')).toBe(100))
  it('unsure → the higher of the two', () => expect(getDisplayValue(est, 'unsure')).toBe(100))
  it('empty enquiry → the higher of the two', () => expect(getDisplayValue(est, '')).toBe(100))
})

describe('rate bands & interest reconciliation', () => {
  it('selects 6.5% below £5,000', () => {
    const s = summaryOf([synthEstimate({ loanValue: 4999, purchaseValue: 4999 })], 'loan')
    expect(s.loanTotal).toBe(4999)
    expect(s.loanInterestRate).toBe(6.5)
    expect(s.isAboveMax).toBe(false)
    expect(s.monthlyInterest).toBe(325)       // round(4999 * 0.065)
    expect(s.totalInterest).toBe(325 * 6)
    expect(s.repaymentAmount).toBe(4999 + 325 * 6)
  })

  it('selects 6.0% at exactly £5,000 (maxExclusive boundary)', () => {
    const s = summaryOf([synthEstimate({ loanValue: 5000, purchaseValue: 5000 })], 'loan')
    expect(s.loanInterestRate).toBe(6.0)
    expect(s.monthlyInterest).toBe(300)
    expect(s.totalInterest).toBe(1800)
    expect(s.repaymentAmount).toBe(6800)
  })

  it('selects 6.0% at exactly £15,000 (maxInclusive boundary)', () => {
    const s = summaryOf([synthEstimate({ loanValue: 15000, purchaseValue: 15000 })], 'loan')
    expect(s.loanInterestRate).toBe(6.0)
    expect(s.isAboveMax).toBe(false)
    expect(s.repaymentAmount).toBe(15000 + 900 * 6)
  })

  it('flags above-max over £15,000 and zeroes interest (loan total still shown)', () => {
    const s = summaryOf([synthEstimate({ loanValue: 15001, purchaseValue: 15001 })], 'loan')
    expect(s.isAboveMax).toBe(true)
    expect(s.loanTotal).toBe(15001)
    expect(s.monthlyInterest).toBe(0)
    expect(s.totalInterest).toBe(0)
    expect(s.repaymentAmount).toBe(0)
  })

  it('always reconciles: monthly × term = total, loan + total = repayment', () => {
    for (const loanValue of [1234, 4999, 5000, 8000, 15000]) {
      const s = summaryOf([synthEstimate({ loanValue, purchaseValue: loanValue })], 'loan')
      expect(s.monthlyInterest * s.loanTermMonths).toBe(s.totalInterest)
      expect(s.loanTotal + s.totalInterest).toBe(s.repaymentAmount)
      expect(Number.isInteger(s.monthlyInterest)).toBe(true)
      expect(Number.isInteger(s.totalInterest)).toBe(true)
      expect(Number.isInteger(s.repaymentAmount)).toBe(true)
    }
  })
})

describe('summary aggregation & whole-£ footing', () => {
  it('per-item whole-£ amounts sum to the total — no round-of-sum drift', () => {
    // Three .5-ending loan values: round-of-sum would give 302, footed gives 303.
    const s = summaryOf([
      synthEstimate({ loanValue: 100.5, purchaseValue: 120.5 }),
      synthEstimate({ loanValue: 100.5, purchaseValue: 120.5 }),
      synthEstimate({ loanValue: 100.5, purchaseValue: 120.5 }),
    ], 'loan')
    expect(s.loanTotal).toBe(303)        // 101 * 3
    expect(s.indicativeValue).toBe(303)
    expect(s.indicativeValue).not.toBe(302) // round(301.5) — the old drift
  })

  it('indicative value follows the enquiry type', () => {
    const items = [
      synthEstimate({ loanValue: 100.5, purchaseValue: 120.5 }),
      synthEstimate({ loanValue: 100.5, purchaseValue: 120.5 }),
      synthEstimate({ loanValue: 100.5, purchaseValue: 120.5 }),
    ]
    expect(summaryOf(items, 'loan').indicativeValue).toBe(303)   // Σ round(100.5)
    expect(summaryOf(items, 'sell').indicativeValue).toBe(363)   // Σ round(120.5)
    expect(summaryOf(items, 'consign').indicativeValue).toBe(363)
  })

  it('excludes manual items from totals but counts them', () => {
    const s = summaryOf([
      synthEstimate({ loanValue: 100, purchaseValue: 120, manual: false }),
      synthEstimate({ loanValue: 0, purchaseValue: 0, manual: true }),
    ], 'loan')
    expect(s.itemCount).toBe(2)
    expect(s.manualCount).toBe(1)
    expect(s.hasManualItems).toBe(true)
    expect(s.loanTotal).toBe(100)
    expect(s.indicativeValue).toBe(100)
  })

  it('handles an empty item set without NaN', () => {
    const s = summaryOf([], 'loan')
    expect(s.itemCount).toBe(0)
    expect(s.purchaseTotal).toBe(0)
    expect(s.loanTotal).toBe(0)
    expect(s.indicativeValue).toBe(0)
    expect(s.isAboveMax).toBe(false)
    expect(s.monthlyInterest).toBe(0)
    expect(s.repaymentAmount).toBe(0)
  })
})

describe('emission — every amount whole and footing (mixed item types)', () => {
  it('sends whole-£ amounts, and the five item amounts add up to gold_total', () => {
    const form = document.createElement('form')
    form.innerHTML = `<input type="radio" name="enquiry_type" value="loan" checked>`
    const summary = summaryFor([
      { itemType: 'jewellery', metalType: '18', weightGrams: '15', quantity: '1' },
      { itemType: 'coin', bullionName: 'sovereign', quantity: '2' },
      { itemType: 'bar', bullionName: '1g_bar', quantity: '3' },
    ], 'loan')
    persistSummary(form, summary)
    const s = submittedFields(form)

    const wholeFields = [
      'gold_purchase_total', 'gold_loan_total', 'gold_indicative_value', 'gold_total',
      'gold_monthly_interest', 'gold_total_interest', 'gold_repayment_amount',
    ]
    wholeFields.forEach((f) => expect(s[f], f).toMatch(/^\d+$/))

    const itemSum = [1, 2, 3, 4, 5]
      .map((i) => Number(s[`gold_item_${i}_amount`] || 0))
      .reduce((a, b) => a + b, 0)
    expect(itemSum).toBe(Number(s.gold_total))
    expect(Number(s.gold_total)).toBe(Number(s.gold_loan_total))

    // Interest still reconciles on the emitted (string) values.
    expect(Number(s.gold_monthly_interest) * summary.loanTermMonths).toBe(Number(s.gold_total_interest))
    expect(Number(s.gold_loan_total) + Number(s.gold_total_interest)).toBe(Number(s.gold_repayment_amount))
  })

  it('emits exactly five slots, Gold asset type for filled, blank for empty', () => {
    const form = document.createElement('form')
    const summary = summaryFor([
      { itemType: 'coin', bullionName: 'sovereign', quantity: '1' },
      { itemType: 'bar', bullionName: '1g_bar', quantity: '1' },
    ], 'sell')
    persistItemSlotFields(form, summary)
    const s = submittedFields(form)

    for (const kind of ['type', 'amount', 'asset_type']) {
      const count = Object.keys(s).filter((k) => new RegExp(`^gold_item_\\d+_${kind}$`).test(k)).length
      expect(count, kind).toBe(5)
    }
    expect(s.gold_item_1_asset_type).toBe('Gold')
    expect(s.gold_item_2_asset_type).toBe('Gold')
    expect(s.gold_item_3_asset_type).toBe('')
    expect(s.gold_item_3_amount).toBe('')
    expect(s.gold_item_1_type).toBe('Coin')
    expect(s.gold_item_2_type).toBe('Bar')
    // No duplicate quantity field.
    expect(Object.keys(s).some((k) => /^quantity_item_\d+$/.test(k))).toBe(false)
  })
})

describe('pricing edge cases', () => {
  it('derives purity from carats (9ct → 0.375) and from percent (sovereign → ~0.9167)', () => {
    const jw = calculateEstimate({ itemType: 'jewellery', metalType: '9', weightGrams: '10', quantity: '1' },
      findPricingRow(pricingRows, { itemType: 'jewellery', metalType: '9' }), quote.spotGbpPerGram)
    expect(jw.purityRatio).toBeCloseTo(0.375, 6)

    const coin = calculateEstimate({ itemType: 'coin', bullionName: 'sovereign', quantity: '1' },
      findPricingRow(pricingRows, { itemType: 'coin', bullionName: 'sovereign' }), quote.spotGbpPerGram)
    expect(coin.purityRatio).toBeCloseTo(0.9167, 4)
  })

  it('floors a zero / invalid quantity to 1 (you cannot price 0 items)', () => {
    const zero = calculateEstimate({ itemType: 'coin', bullionName: 'sovereign', quantity: '0' },
      findPricingRow(pricingRows, { itemType: 'coin', bullionName: 'sovereign' }), quote.spotGbpPerGram)
    const one = calculateEstimate({ itemType: 'coin', bullionName: 'sovereign', quantity: '1' },
      findPricingRow(pricingRows, { itemType: 'coin', bullionName: 'sovereign' }), quote.spotGbpPerGram)
    expect(zero.quantity).toBe(1)
    expect(zero.purchaseValue).toBe(one.purchaseValue)
    expect(zero.loanValue).toBe(one.loanValue)
  })

  it('keeps spotValue on RAW spot while purchase/loan use the discounted spot', () => {
    const est = calculateEstimate({ itemType: 'bar', bullionName: 'pure_1g_bar', quantity: '1' },
      findPricingRow(pricingRows, { itemType: 'bar', bullionName: 'pure_1g_bar' }), 100)
    expect(est.spotValue).toBe(100)     // 1g * 100% * 1 * 100, no discount
    expect(est.purchaseValue).toBe(86)  // mround(100 * 0.98 * 0.88, .5)
    expect(est.loanValue).toBe(73.5)    // mround(100 * 0.98 * 0.75, .5)
  })
})

describe('consistency hardening — traceability & one-precision', () => {
  it('emits the discount and the offer spot so purchase/loan are reconstructable', () => {
    const form = document.createElement('form')
    form.innerHTML = `<input type="radio" name="enquiry_type" value="loan" checked>`
    const summary = summaryFor([
      { itemType: 'bar', bullionName: 'pure_1g_bar', quantity: '1' },
    ], 'loan')
    persistSummary(form, summary)
    const s = submittedFields(form)

    expect(s.gold_spot_discount_percent).toBe('2')
    // Offer spot = raw spot × 0.98, and it is what the offers price from.
    expect(Number(s.gold_offer_spot_price_gbp_gram)).toBeCloseTo(quote.spotGbpPerGram * 0.98, 2)
    expect(Number(s.gold_spot_price_gbp_gram)).toBeCloseTo(quote.spotGbpPerGram, 2)
    // Purchase is reconstructable from the emitted offer spot (before mround).
    const offer = Number(s.gold_offer_spot_price_gbp_gram)
    expect(Number(s.gold_purchase_total)).toBeCloseTo(Math.round(offer * 1 * 0.88), 0)
  })

  it('per-item money is whole £ and foots to each total', () => {
    const form = document.createElement('form')
    form.innerHTML = `<input type="radio" name="enquiry_type" value="loan" checked>`
    const summary = summaryFor([
      { itemType: 'jewellery', metalType: '18', weightGrams: '15', quantity: '1' },
      { itemType: 'coin', bullionName: 'sovereign', quantity: '2' },
      { itemType: 'bar', bullionName: '1g_bar', quantity: '3' },
    ], 'loan')
    persistSummary(form, summary)
    const s = submittedFields(form)

    const sum = (kind) => [1, 2, 3, 4, 5]
      .map((i) => Number(s[`gold_item_${i}_${kind}`] || 0))
      .reduce((a, b) => a + b, 0)

    for (const kind of ['spot_value', 'purchase_value', 'loan_value', 'amount']) {
      for (let i = 1; i <= 3; i += 1) {
        expect(s[`gold_item_${i}_${kind}`], `${kind} ${i}`).toMatch(/^\d+$/)
      }
    }
    expect(sum('purchase_value')).toBe(Number(s.gold_purchase_total))
    expect(sum('loan_value')).toBe(Number(s.gold_loan_total))
    expect(sum('spot_value')).toBe(Number(s.gold_spot_total))
    expect(sum('amount')).toBe(Number(s.gold_total))
  })
})

describe('config — rate bands are shared, not duplicated', () => {
  it('gold and loan reference the exact same rate-band array', () => {
    expect(formConfig.gold.rateBands).toBe(formConfig.loan.rateBands)
  })
})

describe('purity source is type-locked (#2 option A)', () => {
  it('jewellery uses carats and ignores a stray purityPercent', () => {
    // Row carries BOTH — carats is authoritative for jewellery.
    const ratio = getPurityRatio({ itemType: 'jewellery', purityCarats: 22, purityPercent: 50 }, {}, 'jewellery')
    expect(ratio).toBeCloseTo(22 / 24, 6)
    expect(ratio).not.toBeCloseTo(0.5, 3)
  })

  it('jewellery falls back to the entered carat when the row has none', () => {
    const ratio = getPurityRatio({ itemType: 'jewellery' }, { metalType: '18' }, 'jewellery')
    expect(ratio).toBeCloseTo(18 / 24, 6)
  })

  it('coin/bar uses percent and ignores a stray purityCarats', () => {
    const ratio = getPurityRatio({ itemType: 'coin', purityPercent: 91.67, purityCarats: 24 }, {}, 'coin')
    expect(ratio).toBeCloseTo(0.9167, 4)
    expect(ratio).not.toBeCloseTo(1, 3)
  })

  it('isManualRow uses the same type-locked source', () => {
    // Jewellery with only a percent (no carats) → manual, because carats is the
    // jewellery source and it is absent.
    expect(isManualRow({ itemType: 'jewellery', purityPercent: 75 })).toBe(true)
    // Coin with only carats (no percent) → manual, because percent is missing.
    expect(isManualRow({ itemType: 'coin', purityCarats: 22, weightGrams: 7.99 })).toBe(true)
  })
})

// certain coin groups (Swiss/French Francs, Gold American Eagles) are
// priced below the default 88% purchase / 75% loan ratios. A CMS pricing row
// carries `extraDiscountPercent`; both offers for that row are trimmed by a
// FURTHER whole percent ON TOP of the base ratio (multiplicative:
// ratio × (1 - extra/100)). Blank/zero/out-of-range → no adjustment.
describe('gold group discounts', () => {
  // A clean 100% / 1g coin at £100/g spot makes the arithmetic exact:
  //   offerSpot = 100 × 0.98 = 98
  //   purchase (no discount)  = MROUND(98 × 0.88,        0.5) = 86
  //   purchase (6% further)   = MROUND(98 × 0.88 × 0.94, 0.5) = 81
  //   loan     (no discount)  = MROUND(98 × 0.75,        0.5) = 73.5
  //   loan     (6% further)   = MROUND(98 × 0.75 × 0.94, 0.5) = 69
  const SPOT = 100
  const baseRow = { itemType: 'Coin', bullionName: 'eagle_1oz', label: 'Gold American Eagle 1oz', purityPercent: '100', weightGrams: '1' }
  const item = { itemType: 'coin', bullionName: 'eagle_1oz', quantity: '1' }

  it('reads extraDiscountPercent off a CMS pricing row', () => {
    const [row] = normalizePricingRows([{ ...baseRow, extraDiscountPercent: '6' }])
    expect(row.extraDiscountPercent).toBe(6)
  })

  it('getRowOfferMultiplier maps a whole percent to a multiplicative trim', () => {
    expect(getRowOfferMultiplier({ extraDiscountPercent: 6 })).toBeCloseTo(0.94, 10)
    expect(getRowOfferMultiplier({ extraDiscountPercent: 0 })).toBe(1)
    expect(getRowOfferMultiplier({ extraDiscountPercent: NaN })).toBe(1)
    expect(getRowOfferMultiplier({})).toBe(1)
    expect(getRowOfferMultiplier(null)).toBe(1)
    expect(getRowOfferMultiplier({ extraDiscountPercent: 100 })).toBe(1)
    expect(getRowOfferMultiplier({ extraDiscountPercent: -6 })).toBe(1)
  })

  it('trims both purchase and loan by a further 6% for a flagged row', () => {
    const [row] = normalizePricingRows([{ ...baseRow, extraDiscountPercent: '6' }])
    expect(calculateEstimate(item, row, SPOT)).toMatchObject({
      purchaseValue: 81,
      loanValue: 69,
      manual: false,
    })
  })

  it('leaves an identical row untouched when no discount is set (regression guard)', () => {
    const [row] = normalizePricingRows([baseRow])
    expect(row.extraDiscountPercent).toBeNaN()
    expect(calculateEstimate(item, row, SPOT)).toMatchObject({
      purchaseValue: 86,
      loanValue: 73.5,
    })
  })

  it('applies the discount per-row: a flagged coin and a normal coin sum correctly', () => {
    const rows = normalizePricingRows([
      { ...baseRow, extraDiscountPercent: '6' },
      { itemType: 'Coin', bullionName: 'sovereign', label: 'Sovereign', purityPercent: '100', weightGrams: '1' },
    ])
    const eagle = calculateEstimate({ itemType: 'coin', bullionName: 'eagle_1oz', quantity: '1' }, findPricingRow(rows, { itemType: 'coin', bullionName: 'eagle_1oz' }), SPOT)
    const sov = calculateEstimate({ itemType: 'coin', bullionName: 'sovereign', quantity: '1' }, findPricingRow(rows, { itemType: 'coin', bullionName: 'sovereign' }), SPOT)
    expect(eagle.purchaseValue).toBe(81)
    expect(sov.purchaseValue).toBe(86)
    const summary = calculateGoldSummary([eagle, sov], 'sell', { ...quote, spotGbpPerGram: SPOT })
    // Whole-£ total foots to the two whole-£ line items (81 + 86).
    expect(summary.purchaseTotal).toBe(167)
    expect(summary.indicativeValue).toBe(167)
  })
})

// extended coverage — the discount through every downstream path:
// the calculators, the emitted Zoho fields, interest/rate-band selection,
// multi-item footing, fractional percents, and manual rows.
describe('gold group discounts — extended coverage', () => {
  const SPOT = 100 // offerSpot = 100 × 0.98 = 98

  // A 100% / 1g coin priced at £100/g → exact whole-£ arithmetic.
  function coinEstimate({ purityPercent = '100', weightGrams = '1', quantity = '1', extraDiscountPercent, spot = SPOT } = {}) {
    const rows = normalizePricingRows([
      { itemType: 'Coin', bullionName: 'c', label: 'C', purityPercent, weightGrams, ...(extraDiscountPercent != null ? { extraDiscountPercent } : {}) },
    ])
    const item = { itemType: 'coin', bullionName: 'c', quantity }
    return calculateEstimate(item, findPricingRow(rows, item), spot)
  }
  function coinSummary(opts, enquiryType = 'loan') {
    return calculateGoldSummary([coinEstimate(opts)], enquiryType, { ...quote, spotGbpPerGram: opts.spot ?? SPOT })
  }

  describe('calculators accept an offerAdjust and default to 1', () => {
    it('purchase: coin trims with adjust, unchanged without', () => {
      expect(calculatePurchaseValue('coin', 1, 1, 1, 98, 0.94).purchaseValue).toBe(81)
      expect(calculatePurchaseValue('coin', 1, 1, 1, 98).purchaseValue).toBe(86) // default 1
    })
    it('loan: coin trims with adjust, unchanged without', () => {
      expect(calculateLoanValue('coin', 1, 1, 1, 98, 0.94).loanValue).toBe(69)
      expect(calculateLoanValue('coin', 1, 1, 1, 98).loanValue).toBe(73.5) // default 1
    })
    it('the trim is generic — it applies to jewellery too if a row ever sets it', () => {
      // Coin-only scope is a CMS-data choice (only coin rows carry the field),
      // not a code restriction. The mechanism itself is item-type agnostic.
      expect(calculatePurchaseValue('jewellery', 10, 1, 1, 98, 0.94).purchaseValue).toBe(810)
      expect(calculatePurchaseValue('jewellery', 10, 1, 1, 98).purchaseValue).toBe(860)
    })
  })

  it('purchase/loan fall monotonically as the discount grows', () => {
    expect(coinEstimate({}).purchaseValue).toBe(86) // 0%
    expect(coinEstimate({ extraDiscountPercent: '6' }).purchaseValue).toBe(81)
    expect(coinEstimate({ extraDiscountPercent: '10' }).purchaseValue).toBe(77.5)
    expect(coinEstimate({}).loanValue).toBe(73.5)
    expect(coinEstimate({ extraDiscountPercent: '6' }).loanValue).toBe(69)
    expect(coinEstimate({ extraDiscountPercent: '10' }).loanValue).toBe(66)
  })

  it('accepts a fractional discount percent', () => {
    // 6.5% → × 0.935: purchase mround(98×0.88×0.935,0.5)=80.5, loan mround(98×0.75×0.935,0.5)=68.5
    const est = coinEstimate({ extraDiscountPercent: '6.5' })
    expect(est.purchaseValue).toBe(80.5)
    expect(est.loanValue).toBe(68.5)
  })

  it('emits the discounted whole-£ values to the Zoho item fields', () => {
    const form = document.createElement('form')
    persistItemSlotFields(form, coinSummary({ extraDiscountPercent: '6' }, 'sell'))
    const val = (n) => form.querySelector(`[name="${n}"]`).value
    expect(val('gold_item_1_purchase_value')).toBe('81')
    expect(val('gold_item_1_loan_value')).toBe('69')
    expect(val('gold_item_1_spot_value')).toBe('100')
    expect(val('gold_item_1_amount')).toBe('81') // sell → purchase basis
  })

  it('foots a mixed lead: discounted coin + full-rate coin + jewellery', () => {
    const rows = normalizePricingRows([
      { itemType: 'Coin', bullionName: 'eagle', label: 'Eagle', purityPercent: '100', weightGrams: '1', extraDiscountPercent: '6' },
      { itemType: 'Coin', bullionName: 'sov', label: 'Sov', purityPercent: '100', weightGrams: '1' },
      { itemType: 'Jewellery', label: '18ct', purityCarats: '18', weightGrams: '10' },
    ])
    const items = [
      { itemType: 'coin', bullionName: 'eagle', quantity: '1' },   // 81
      { itemType: 'coin', bullionName: 'sov', quantity: '1' },     // 86
      { itemType: 'jewellery', metalType: '18', weightGrams: '10', quantity: '1' }, // 645
    ]
    const estimates = items.map((it) => calculateEstimate(it, findPricingRow(rows, it), SPOT))
    const summary = calculateGoldSummary(estimates, 'sell', { ...quote, spotGbpPerGram: SPOT })
    expect(estimates.map((e) => e.purchaseValue)).toEqual([81, 86, 645])
    expect(summary.purchaseTotal).toBe(812) // 81 + 86 + 645 — foots to line items
    expect(summary.indicativeValue).toBe(812)
  })

  it('computes interest on the discounted loan total', () => {
    const summary = coinSummary({ weightGrams: '31.1', extraDiscountPercent: '6' })
    const undiscounted = coinSummary({ weightGrams: '31.1' })
    // Discount flows into the interest base…
    expect(summary.loanTotal).toBeLessThan(undiscounted.loanTotal)
    // …and interest still reconciles against the (discounted) total.
    expect(summary.monthlyInterest).toBe(roundWholePound(summary.loanTotal * summary.loanInterestRate / 100))
  })

  it('a discount can push the loan into a higher (smaller-loan) rate band', () => {
    // weight 6.94 g × qty 10 @ £100/g: loan 5,100 (6.0% band) → discounted 4,795 (<5,000 → 6.5%).
    const full = coinSummary({ weightGrams: '6.94', quantity: '10' })
    const disc = coinSummary({ weightGrams: '6.94', quantity: '10', extraDiscountPercent: '6' })
    expect(full.loanTotal).toBe(5100)
    expect(full.loanInterestRate).toBe(6)
    expect(disc.loanTotal).toBe(4795)
    expect(disc.loanInterestRate).toBe(6.5)
  })

  it('manual rows ("other"/"unsure") stay £0 regardless of any discount', () => {
    const rows = normalizePricingRows([
      { itemType: 'Coin', bullionName: 'c', label: 'C', purityPercent: '100', weightGrams: '1', extraDiscountPercent: '6' },
    ])
    const est = calculateEstimate({ itemType: 'coin', bullionName: 'other', quantity: '1' }, findPricingRow(rows, { itemType: 'coin', bullionName: 'other' }), SPOT)
    expect(est.manual).toBe(true)
    expect(est.purchaseValue).toBe(0)
    expect(est.loanValue).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 869eu8kr1 — the September 2026 change round. These run on the LIVE config,
// undoing the top-level pin, so a rate edited in config.js fails HERE.
// ---------------------------------------------------------------------------
describe('live configured rates (869eu8kr1)', () => {
  beforeEach(() => {
    Object.assign(formConfig.gold, LIVE_RATES)
  })

  it('carries the rates the client asked for', () => {
    // Sam, 25 Aug 2026: top line discount 2% -> 3%; jewellery only 88% -> 86%,
    // coins and bars remain at 88%.
    expect(formConfig.gold.spotDiscountPercent).toBe(3)
    expect(formConfig.gold.purchaseToValuePercent).toBe(88)
    expect(formConfig.gold.purchaseToValuePercentByItemType.jewellery).toBe(86)
    expect(getSpotOfferMultiplier()).toBeCloseTo(0.97, 10)
  })

  it('applies 86% to jewellery purchases and 88% to coins and bars', () => {
    expect(getOfferRatio('purchase', 'jewellery')).toBeCloseTo(0.86, 10)
    expect(getOfferRatio('purchase', 'coin')).toBeCloseTo(0.88, 10)
    expect(getOfferRatio('purchase', 'bar')).toBeCloseTo(0.88, 10)
  })

  it('leaves every loan ratio on loanToValuePercent, jewellery included', () => {
    // The per-item-type table is consulted for purchases only. If this ever
    // fails, a jewellery purchase rate has started moving loan offers.
    expect(getOfferRatio('loan', 'jewellery')).toBeCloseTo(0.75, 10)
    expect(getOfferRatio('loan', 'coin')).toBeCloseTo(0.75, 10)
    expect(getOfferRatio('loan', undefined)).toBeCloseTo(0.75, 10)
  })

  it('falls back to the flat 88% for an unknown item type, never to 0 or 1', () => {
    // A blank fallback quoting 1 would offer 100% of spot; 0 would offer
    // nothing. Both look plausible on screen, so they are guarded explicitly.
    const ratio = getOfferRatio('purchase', 'something-else')
    expect(ratio).toBeCloseTo(0.88, 10)
    expect(ratio).not.toBe(1)
    expect(ratio).not.toBe(0)
  })

  it('ignores a blank or non-numeric per-item-type entry', () => {
    const original = formConfig.gold.purchaseToValuePercentByItemType
    try {
      for (const bad of [{ jewellery: '' }, { jewellery: 'abc' }, { jewellery: 0 }, {}]) {
        formConfig.gold.purchaseToValuePercentByItemType = bad
        expect(getOfferRatio('purchase', 'jewellery')).toBeCloseTo(0.88, 10)
      }
    } finally {
      formConfig.gold.purchaseToValuePercentByItemType = original
    }
  })

  // The worked examples sent to the client for sign-off. £100/g keeps the
  // arithmetic checkable by hand against their pricing sheet.
  it('quotes 18ct jewellery, 15g at £100/g as £937.50 purchase and £817.50 loan', () => {
    const item = { itemType: 'jewellery', metalType: '18', weightGrams: '15', quantity: '1' }
    const estimate = calculateEstimate(item, findPricingRow(pricingRows, item), 100)

    expect(estimate.purchaseValue).toBe(937.5)
    expect(estimate.loanValue).toBe(817.5)
    // The displayed spot stays on RAW spot — the discount is offers-only.
    expect(estimate.spotValue).toBe(1125)
    expect(estimate.calculation.purchasePercent).toBe(86)
    expect(estimate.calculation.loanPercent).toBe(75)
  })

  it('keeps a Sovereign on 88%, still reduced by the 3% top line', () => {
    const item = { itemType: 'coin', bullionName: 'sovereign', quantity: '1' }
    const estimate = calculateEstimate(item, findPricingRow(pricingRows, item), 100)

    expect(estimate.purchaseValue).toBe(625)
    expect(estimate.loanValue).toBe(533)
    expect(estimate.calculation.purchasePercent).toBe(88)
  })

  it('composes a row extraDiscountPercent on top of the jewellery rate, not instead of it', () => {
    // Francs and American Eagles carry a 6% row discount. 86% must become
    // 86 x 0.94 = 80.84%, never 6% replacing the rate.
    const rows = normalizePricingRows([
      { itemType: 'Jewellery', label: '18ct discounted', purityCarats: '18', weightGrams: '10', extraDiscountPercent: '6' },
    ])
    const item = { itemType: 'jewellery', metalType: '18', weightGrams: '10', quantity: '1' }
    const estimate = calculateEstimate(item, rows[0], 100)

    expect(estimate.calculation.purchasePercent).toBeCloseTo(80.84, 2)
    expect(estimate.calculation.loanPercent).toBeCloseTo(70.5, 2)
    expect(estimate.purchaseValue).toBe(590)
    expect(estimate.loanValue).toBe(515)
  })
})

// ---------------------------------------------------------------------------
// bullion_name_N is the value that actually reaches Zoho, and nothing asserted
// it before this change round.
// ---------------------------------------------------------------------------
describe('bullion_name_N — the single item description (869eu8kr1)', () => {
  function slotValues(items) {
    const form = document.createElement('form')
    document.body.append(form)
    persistItemSlotFields(form, summaryFor(items, 'sell'))
    const read = (name) => form.querySelector(`[name="${name}"]`)?.value
    const out = {
      description1: read('bullion_name_1'),
      bullionType1: read('gold_item_1_bullion_type'),
      description2: read('bullion_name_2'),
      metalType1: read('gold_item_1_metal_type'),
      label1: read('gold_item_1_label'),
      description5: read('bullion_name_5'),
    }
    form.remove()
    return out
  }

  it('describes jewellery as "<carat>ct Gold Jewellery", the client\'s exact wording', () => {
    // Their 10 Aug table asked for "9ct Gold Jewellery" and this now sends it
    // verbatim. An earlier build sent the bare "9ct Gold" on the grounds that
    // Item_N_Description appends {{gold_item_N_type}} and the full phrase
    // would read "9ct Gold Jewellery 1 Jewellery" — but that template is the
    // client's and the Zap draft drops the trailing token, so the description
    // reads "9ct Gold Jewellery 1".
    //
    // Note this is deliberately NOT the same value as gold_item_N_metal_type,
    // which stays "9ct Gold" because Zoho's Metal picklist has no option for
    // the longer phrase. Asserted together below so the two cannot drift.
    const nine = slotValues([{ itemType: 'jewellery', metalType: '9', weightGrams: '10', quantity: '1' }])
    expect(nine.description1).toBe('9ct Gold Jewellery')
    expect(nine.metalType1).toBe('9ct Gold')

    expect(slotValues([{ itemType: 'jewellery', metalType: '18', weightGrams: '10', quantity: '1' }]).description1)
      .toBe('18ct Gold Jewellery')
  })

  it('emits the carat as a valid Item_N_Metal option, not the bare number', () => {
    // Zoho's Item_N_Metal picklist spells these "9ct Gold" ... "24ct Gold".
    // The bare "9" matched no option on the 16 Aug lead.
    const v = slotValues([{ itemType: 'jewellery', metalType: '18', weightGrams: '10', quantity: '1' }])
    expect(v.metalType1).toBe('18ct Gold')
  })

  it('leaves metal empty for coins and bars, which carry no carat', () => {
    expect(slotValues([{ itemType: 'coin', bullionName: 'sovereign', quantity: '1' }]).metalType1).toBe('')
  })

  it('leaves coin and bar descriptions on their CMS label, unchanged', () => {
    // His note against both was "No change, I don't think." These already
    // arrive as valid Item_N_Bullion_Type options.
    expect(slotValues([{ itemType: 'coin', bullionName: 'sovereign', quantity: '1' }]).description1)
      .toBe('Sovereign')
    expect(slotValues([{ itemType: 'bar', bullionName: '1g_bar', quantity: '1' }]).description1)
      .toBe('1g Gold Bar')
  })

  it('keeps the CMS label on gold_item_N_label, untouched', () => {
    // label is display copy and feeds the on-screen item list; only the
    // Zoho-facing bullion_name_N carries the combined description.
    const v = slotValues([{ itemType: 'jewellery', metalType: '18', weightGrams: '10', quantity: '1' }])
    expect(v.label1).toBe('18ct jewellery')
  })

  it('sends no Bullion Type for a manual "Other" or "Unsure" row', () => {
    // findPricingRow synthesises label "Other"/"Unsure" for the unmatched
    // options. Neither is among the 38 Item_N_Bullion_Type options, so sending
    // it would store an unlisted string — silently unusable, which is the
    // defect this field was added to remove.
    expect(slotValues([{ itemType: 'coin', bullionName: 'other', quantity: '1' }]).bullionType1).toBe('')
    expect(slotValues([{ itemType: 'bar', bullionName: 'unsure', quantity: '1' }]).bullionType1).toBe('')
  })

  it('sends a Bullion Type only for coins and bars, never for jewellery', () => {
    // Item_N_Bullion_Type is a coin/bar picklist. An unlisted jewellery string
    // is accepted and stored by Zoho, so it fails as DATA rather than as a
    // write — nothing errors, it just cannot be grouped or reported.
    expect(slotValues([{ itemType: 'coin', bullionName: 'sovereign', quantity: '1' }]).bullionType1)
      .toBe('Sovereign')
    expect(slotValues([{ itemType: 'bar', bullionName: '1g_bar', quantity: '1' }]).bullionType1)
      .toBe('1g Gold Bar')
    expect(slotValues([{ itemType: 'jewellery', metalType: '18', weightGrams: '10', quantity: '1' }]).bullionType1)
      .toBe('')
  })

  it('always sends Gold as slot 1 asset type, even with nothing priced', () => {
    // 869eu8kr1 item 3. The Describe Items route parses no items, so slot 1
    // used to submit an empty asset type and the lead arrived untagged.
    const form = document.createElement('form')
    document.body.append(form)
    persistItemSlotFields(form, summaryFor([], 'sell'))
    const read = (n) => form.querySelector(`[name="${n}"]`)?.value

    expect(read('gold_item_1_asset_type')).toBe('Gold')
    // Slots 2-5 stay gated, so an unused slot cannot create a phantom row.
    expect(read('gold_item_2_asset_type')).toBe('')
    expect(read('gold_item_5_asset_type')).toBe('')
    form.remove()
  })

  it('writes an empty description for an unused slot', () => {
    expect(slotValues([{ itemType: 'coin', bullionName: 'sovereign', quantity: '1' }]).description5).toBe('')
  })

  it('numbers each slot independently across a mixed lead', () => {
    const v = slotValues([
      { itemType: 'jewellery', metalType: '22', weightGrams: '5', quantity: '1' },
      { itemType: 'coin', bullionName: 'sovereign', quantity: '2' },
    ])
    expect(v.description1).toBe('22ct Gold Jewellery')
    expect(v.description2).toBe('Sovereign')
  })
})

// ---------------------------------------------------------------------------
// gold_purchase_rate_percent used to hardcode the flat config value, so a
// jewellery lead claimed 88% while 86% was applied. It now reports the rates
// actually used.
// ---------------------------------------------------------------------------
describe('gold_purchase_rate_percent reports the applied rate (869eu8kr1)', () => {
  beforeEach(() => {
    Object.assign(formConfig.gold, LIVE_RATES)
  })

  function submitted(items, enquiryType = 'sell') {
    const form = document.createElement('form')
    form.innerHTML = `<input type="radio" name="enquiry_type" value="${enquiryType}" checked>`
    persistSummary(form, summaryFor(items, enquiryType))
    return submittedFields(form)
  }

  it('reports 86 for an all-jewellery lead', () => {
    const f = submitted([{ itemType: 'jewellery', metalType: '18', weightGrams: '10', quantity: '1' }])
    expect(f.gold_purchase_rate_percent).toBe('86')
    expect(f.gold_loan_rate_percent).toBe('75')
  })

  it('reports 88 for an all-coin lead', () => {
    const f = submitted([{ itemType: 'coin', bullionName: 'sovereign', quantity: '1' }])
    expect(f.gold_purchase_rate_percent).toBe('88')
  })

  it('reports both rates, ascending, for a mixed lead', () => {
    // Five slots means a lead can genuinely mix types, and then no single
    // rate is true. Saying "86, 88" beats picking one and being wrong.
    const f = submitted([
      { itemType: 'jewellery', metalType: '18', weightGrams: '10', quantity: '1' },
      { itemType: 'coin', bullionName: 'sovereign', quantity: '1' },
    ])
    expect(f.gold_purchase_rate_percent).toBe('86, 88')
    expect(f.gold_loan_rate_percent).toBe('75')
  })

  it('excludes a row extraDiscountPercent from the reported rate', () => {
    // The Francs/Eagles 6% row discount belongs to the row, not the rate; its
    // effect is already visible in the per-item values.
    const rows = normalizePricingRows([
      { itemType: 'Coin', bullionName: 'franc', label: '20 Franc', purityPercent: '90', weightGrams: '5.8', extraDiscountPercent: '6' },
    ])
    const item = { itemType: 'coin', bullionName: 'franc', quantity: '1' }
    const summary = calculateGoldSummary([calculateEstimate(item, rows[0], 100)], 'sell', { spotGbpPerGram: 100, source: 't', updatedAt: 1781172000 })
    const form = document.createElement('form')
    form.innerHTML = `<input type="radio" name="enquiry_type" value="sell" checked>`
    persistSummary(form, summary)

    expect(submittedFields(form).gold_purchase_rate_percent).toBe('88')
  })

  it('falls back to the flat config rate when nothing was priced', () => {
    // The Describe Items route prices no items, so it keeps reporting exactly
    // what it always did rather than going blank.
    const f = submitted([])
    expect(f.gold_purchase_rate_percent).toBe('88')
    expect(f.gold_loan_rate_percent).toBe('75')
  })
})

// ---------------------------------------------------------------------------
// addItem() clones the previous row, so a row can arrive already carrying the
// previous row's EXPANDED rule. Rewriting in place could never fix that.
// ---------------------------------------------------------------------------
describe('repeater condition rules survive cloning (multi-item weight reveal)', () => {
  function buildForm() {
    const form = document.createElement('form')
    form.innerHTML = `
      <div data-form-gold-item>
        <div data-form-field="item_type">
          <input type="radio" id="item_type_coin" name="item_type" value="coin" checked>
        </div>
        <div data-form-field="weight_grams" data-form-show-if="item_type = jewellery OR bullion_name = other">
          <input id="weight_grams" name="weight_grams" value="">
        </div>
        <div data-form-field="bullion_name" data-form-show-if="item_type = coin">
          <select id="bullion_name_coin" name="bullion_name">
            <option value=""></option>
            <option value="other">Other</option>
          </select>
        </div>
        <div data-form-field="bullion_name" data-form-show-if="item_type = bar">
          <select id="bullion_name_bar" name="bullion_name">
            <option value=""></option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
    `
    document.body.append(form)
    return form
  }

  const weightRule = (item) =>
    item.querySelector('[data-form-field="weight_grams"]').getAttribute('data-form-show-if')

  it('re-indexes a cloned row instead of leaving it pointing at row 1', () => {
    const form = buildForm()
    updateRepeaterState({ form })

    const first = form.querySelector('[data-form-gold-item]')
    expect(weightRule(first)).toContain('gold_bullion_name_1')

    // Exactly what addItem() does: clone the last row, append, re-sync.
    form.append(first.cloneNode(true))
    updateRepeaterState({ form })

    const [, second] = form.querySelectorAll('[data-form-gold-item]')
    const rule = weightRule(second)

    // The defect: `gold_bullion_name_1_coin` cannot be re-matched by the
    // base-name pattern, so row 2 kept row 1's reference and its weight field
    // never revealed on its own selection.
    expect(rule).toContain('gold_bullion_name_2')
    expect(rule).not.toContain('gold_bullion_name_1')
    expect(weightRule(first)).toContain('gold_bullion_name_1')
    form.remove()
  })

  it('stays stable when the same row is synced repeatedly', () => {
    const form = buildForm()
    const item = form.querySelector('[data-form-gold-item]')

    updateRepeaterState({ form })
    const once = weightRule(item)
    updateRepeaterState({ form })
    updateRepeaterState({ form })

    expect(weightRule(item)).toBe(once)
    form.remove()
  })
})
