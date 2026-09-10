import { describe, expect, it } from 'vitest'
import { calculateLoanSummary, formatLoanHelpMessage, formatLoanSavingsMessage, loanCalculationTestHooks } from '../loan.js'
import { submittedFields } from "./helpers/webflow-submit.js"

describe('loan calculator financials', () => {
  it('calculates the default 5000 pound, 3 month example at the 6 percent band', () => {
    expect(calculateLoanSummary(5000, 3)).toMatchObject({
      isEnquiry: false,
      rate: 6,
      monthlyInterest: 300,
      totalInterest: 900,
      totalRedeem: 5900,
      competitorRate: 9,
      savings: 450,
      hasSaving: true,
    })
  })

  it('uses the 6.5 percent band below 5000 pounds', () => {
    expect(calculateLoanSummary(500, 1)).toMatchObject({
      isEnquiry: false,
      rate: 6.5,
      monthlyInterest: 32.5,
      totalInterest: 32.5,
      totalRedeem: 532.5,
      competitorRate: 10.49,
      savings: 19.95,
      hasSaving: true,
    })
  })

  it('quotes 14999 pounds at the 6 percent band (just under the slider maximum)', () => {
    expect(calculateLoanSummary(14999, 3)).toMatchObject({
      isEnquiry: false,
      rate: 6,
      hasCompetitorRate: false,
      competitorRate: 0,
      savings: 0,
      hasSaving: false,
    })
  })

  it('treats the slider maximum (15000, the "15,000+" position) as the enquiry state', () => {
    expect(calculateLoanSummary(15000, 3)).toMatchObject({
      isEnquiry: true,
      monthlyInterest: 0,
      totalInterest: 0,
      totalRedeem: 0,
      savings: 0,
      hasSaving: false,
    })
  })

  it('uses inclusive max amounts for the updated competitor rate card', () => {
    expect(calculateLoanSummary(1500, 1)).toMatchObject({ competitorRate: 10.49 })
    expect(calculateLoanSummary(3500, 1)).toMatchObject({ competitorRate: 9.49 })
    expect(calculateLoanSummary(5000, 1)).toMatchObject({ competitorRate: 9 })
    expect(calculateLoanSummary(7500, 1)).toMatchObject({ competitorRate: 8 })
    expect(calculateLoanSummary(10000, 1)).toMatchObject({ competitorRate: 7 })
  })

  it('formats the savings output as a full paragraph sentence', () => {
    const summary = calculateLoanSummary(5000, 3)

    expect(formatLoanSavingsMessage(summary)).toBe("Save £450 compared to the UK's largest pawnbroker")
  })

  it('formats the fallback paragraph when there is no saving against a competitor band', () => {
    expect(formatLoanSavingsMessage({
      isEnquiry: false,
      hasCompetitorRate: true,
      hasSaving: false,
      savings: 0,
    })).toBe("Our rates are similar to the largest pawnbroker. Find out why to choose us.")
  })

  it('shows no comparative message when there is no competitor band', () => {
    const summary = calculateLoanSummary(12000, 3)
    expect(summary).toMatchObject({ isEnquiry: false, hasCompetitorRate: false, savings: 0 })
    expect(formatLoanSavingsMessage(summary)).toBe('')
  })

  it('leaves help text empty for enquiry amounts so the UI can show its enquiry-only message', () => {
    expect(formatLoanHelpMessage(calculateLoanSummary(15000, 3))).toBe(
      '',
    )
  })

  it('submits requested_amount without duplicating it as loan_amount', () => {
    const form = document.createElement('form')
    form.innerHTML = `
      <input data-form-loan-amount value="5000">
      <input type="radio" name="loan_duration" value="3" checked>
    `

    loanCalculationTestHooks.doRefresh(form)

    const submitted = submittedFields(form)
    expect(submitted.requested_amount).toBe('5000')
    expect(submitted.loan_amount).toBeUndefined()
    expect(submitted.loan_duration_months).toBe('3')
    expect(submitted.loan_interest_rate).toBe('6')
    expect(form.querySelector('[name="requested_amount"]').type).toBe('hidden')
  })

  it('renders the banded rate with one decimal place (6.5%, not rounded to 7%)', () => {
    const form = document.createElement('form')
    form.innerHTML = `
      <input data-form-loan-amount value="4000">
      <input type="radio" name="loan_duration" value="6" checked>
      <span data-form-loan-output="interest_rate"></span>
    `

    loanCalculationTestHooks.doRefresh(form)

    expect(form.querySelector('[data-form-loan-output="interest_rate"]').textContent).toBe('6.5%')
  })

  it('pads whole-number rates to one decimal so both bands read alike (6.0%, not 6%)', () => {
    const form = document.createElement('form')
    form.innerHTML = `
      <input data-form-loan-amount value="5000">
      <input type="radio" name="loan_duration" value="3" checked>
      <span data-form-loan-output="interest_rate"></span>
    `

    loanCalculationTestHooks.doRefresh(form)

    expect(form.querySelector('[data-form-loan-output="interest_rate"]').textContent).toBe('6.0%')
  })

  it('leaves the rate blank at the enquiry cap rather than rendering a padded 0.0%', () => {
    const form = document.createElement('form')
    form.innerHTML = `
      <input data-form-loan-amount value="15000">
      <input type="radio" name="loan_duration" value="6" checked>
      <span data-form-loan-output="interest_rate"></span>
    `

    loanCalculationTestHooks.doRefresh(form)

    expect(form.querySelector('[data-form-loan-output="interest_rate"]').textContent).toBe('')
    expect(submittedFields(form).loan_interest_rate).toBe('')
  })
})
