import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'coste-skill',
  component: 'Pane',
  requestId: 'coste-skill',
  props: {
    title: 'Coste por skill',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('lista las skills con su coste y mide el cuerpo al invocarlas', async ($, on) => {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'coste-skill' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.cwd', () => ({ value: '/proyecto' }))
  on('env.get', () => ({ value: '/home/x' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => {
    throw new Error('no existe')
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        window: 200000,
        breakdown: {
          skills: {
            totalSkills: 2,
            includedSkills: 2,
            tokens: 120,
            skillFrontmatter: [
              { name: 'commit', source: 'built-in', tokens: 70 },
              { name: 'deploy', source: 'userSettings', tokens: 50 },
            ],
          },
        },
      },
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.skill.prompt({ skill: 'commit', text: 'x'.repeat(4000) })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /commit/ }))?.text).toBe('commit')
    expect((await ui.find({ type: 'Text', text: /1\.0k tokens/ }))?.text).toMatch(/1\.0k tokens/)
    expect((await ui.find({ type: 'Text', text: /sin medir/ }))?.text).toMatch(/sin medir/)
    await ui.unmount()
  }
})
