import { describe, expect, it } from 'vitest'
import {
  displayPathTail,
  normalizeDisplayPath,
  relativePathWithin,
} from '../src/utils/platform'

describe('renderer path helpers', () => {
  it('normalizes Windows separators for display', () => {
    expect(normalizeDisplayPath('C:\\Users\\tester\\project')).toBe('C:/Users/tester/project')
    expect(displayPathTail('C:\\Users\\tester\\project')).toBe('tester/project')
  })

  it('formats POSIX paths without changing their meaning', () => {
    expect(displayPathTail('/Users/tester/project/')).toBe('tester/project')
  })

  it('returns relative paths for Windows and POSIX children', () => {
    expect(relativePathWithin('C:\\Users\\tester\\project', 'C:\\Users\\tester\\project\\src\\main.ts'))
      .toBe('src/main.ts')
    expect(relativePathWithin('C:\\Users\\Tester\\Project', 'c:\\users\\tester\\project\\src\\main.ts'))
      .toBe('src/main.ts')
    expect(relativePathWithin('/home/tester/project', '/home/tester/project/src/main.ts'))
      .toBe('src/main.ts')
  })

  it('does not treat sibling paths as children', () => {
    expect(relativePathWithin('/home/tester/project', '/home/tester/project-copy/file.ts')).toBeNull()
  })
})
