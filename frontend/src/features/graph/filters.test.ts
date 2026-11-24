import { describe, expect, it } from 'vitest'
import { inFolder, matchesText } from './filters.ts'

describe('graph filters', () => {
  it('matches text by title or c-number', () => {
    expect(matchesText({ id: 3, title: 'Field rules' }, 'field')).toBe(true)
    expect(matchesText({ id: 3, title: 'Field rules' }, 'c3')).toBe(true)
    expect(matchesText({ id: 3, title: 'Field rules' }, 'zzz')).toBe(false)
    expect(matchesText({ id: 3, title: 'x' }, '  ')).toBe(true)
  })

  it('matches folders including sub-folders', () => {
    expect(inFolder('project/api', 'project')).toBe(true)
    expect(inFolder('projects', 'project')).toBe(false)
    expect(inFolder('anything', '')).toBe(true)
  })
})
