import { describe, expect, it } from 'vitest'
import { fieldValidators, fieldRules } from '../config.js'

describe('email validator', () => {
  it('accepts normal addresses (incl. internal dots and subdomains)', () => {
    expect(fieldValidators.email('jo@example.com')).toBe(true)
    expect(fieldValidators.email('first.last@example.co.uk')).toBe(true)
    expect(fieldValidators.email('jo@mail.sub.example.com')).toBe(true)
    expect(fieldValidators.email('  jo@example.com  ')).toBe(true) // trimmed before test
  })

  // Zoho's email field rejects a trailing dot, so the form must too.
  it('rejects a trailing dot (Zoho would reject it)', () => {
    expect(fieldValidators.email('jo@example.com.')).toBe(false)
  })

  it('rejects consecutive dots, leading domain dot, and missing TLD', () => {
    expect(fieldValidators.email('jo@example..com')).toBe(false)
    expect(fieldValidators.email('jo@.example.com')).toBe(false)
    expect(fieldValidators.email('jo@localhost')).toBe(false)
    expect(fieldValidators.email('jo@@example.com')).toBe(false)
    expect(fieldValidators.email('jo@example.')).toBe(false)
    expect(fieldValidators.email('<script>@example.com')).toBe(false)
  })

  it('caps email length at 100 to match Zoho', () => {
    expect(fieldRules.email.maxlength).toBe(100)
  })
})
