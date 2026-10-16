import { describe, expect, it } from 'vitest'
import { formatMinutes, parseDuration } from '../dates'
import { fromStorage, toStorage } from '@/components/MentionEditor'

describe('durations', () => {
  it('parses common formats', () => {
    expect(parseDuration('1h 30m')).toBe(90)
    expect(parseDuration('1.5h')).toBe(90)
    expect(parseDuration('45m')).toBe(45)
    expect(parseDuration('45')).toBe(45)
    expect(parseDuration('2:15')).toBe(135)
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('')).toBeNull()
  })
  it('formats minutes', () => {
    expect(formatMinutes(95)).toBe('1h 35m')
    expect(formatMinutes(60)).toBe('1h')
    expect(formatMinutes(20)).toBe('20m')
    expect(formatMinutes(0)).toBe('0m')
  })
})

describe('mentions', () => {
  const id = '11111111-2222-3333-4444-555555555555'
  it('round-trips storage tokens', () => {
    const body = `Hi @[Ann Lee](user:${id}), can you check?`
    const { text, mentions } = fromStorage(body)
    expect(text).toBe('Hi @Ann Lee, can you check?')
    expect(toStorage(text, mentions)).toBe(body)
  })
  it('only converts names picked from the menu, and not inside emails', () => {
    const m = new Map([['Ann', id]])
    expect(toStorage('ping @Ann and mail ann@Ann.com', m)).toBe(`ping @[Ann](user:${id}) and mail ann@Ann.com`)
    expect(toStorage('@Bob hi', m)).toBe('@Bob hi')
  })
})
