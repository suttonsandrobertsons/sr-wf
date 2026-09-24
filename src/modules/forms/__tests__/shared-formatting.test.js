import { describe, expect, it } from 'vitest'
import { formatMoney, formatNumber, getRateBand } from '../numbers.js'
import { formConfig } from '../config.js'

describe('calculator display formatting', () => {
  it('defaults money and number displays to whole values', () => {
    expect(formatMoney(1234.56)).toBe('£1,235')
    expect(formatNumber(93.21)).toBe('93')
  })

  it('supports inclusive max rate bands for spreadsheet max-amount tiers', () => {
    const bands = [
      { maxInclusive: 1500, rate: 10.49 },
      { maxInclusive: 3500, rate: 9.49 },
    ]

    expect(getRateBand(1500, bands)).toMatchObject({ rate: 10.49 })
    expect(getRateBand(1501, bands)).toMatchObject({ rate: 9.49 })
  })

  it('gold and loan rate cards agree at the shared £15,000 ceiling (loan.max)', () => {
    // Both calculators share one rate card, so a value at loan.max is quotable,
    // not "above max", in both.
    expect(formConfig.loan.max).toBe(15000)
    expect(getRateBand(15000, formConfig.gold.rateBands)).toMatchObject({ interestRate: 6.0 })
    expect(getRateBand(15000, formConfig.loan.rateBands)).toMatchObject({ interestRate: 6.0 })
  })
})
