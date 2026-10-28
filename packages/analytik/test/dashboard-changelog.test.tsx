import { describe, expect, it } from 'vitest'

import { parseChangelog } from '../src/dashboard/views/Changelog'

describe('parseChangelog', () => {
  it('reads releases, groups and wrapped bullets, and skips empty releases', () => {
    const source = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '## [1.0.0]',
      '',
      '### Added',
      '',
      '- First',
      '  wrapped line',
      '- Second',
    ].join('\n')
    expect(parseChangelog(source)).toEqual([
      { version: '1.0.0', groups: [{ title: 'Added', items: ['First wrapped line', 'Second'] }] },
    ])
  })
})
