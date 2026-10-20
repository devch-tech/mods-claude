import { expect, test } from 'claude-code/testing'

test('cuenta lecturas y ediciones por archivo', async ($, on) => {
  on('command.register', () => ({ value: { command: 'archivos' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1 }))
  on('session.cwd', () => ({ value: 'C:/proyecto' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: 'C:/proyecto/src/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/proyecto/src/a.ts' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/proyecto/src/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/proyecto/README.md' })

  const ui = await $.ui.mount({
    plugin: 'radar-archivos',
    component: 'Pane',
    requestId: 'radar-archivos',
    surface: 'desktop',
    props: { title: 'Radar', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  expect((await ui.find({ type: 'Text', text: /2 archivos/ }))?.text).toBe('2 archivos')
  expect((await ui.find({ type: 'Text', text: /^src\/a\.ts$/ }))?.text).toBe('src/a.ts')
  expect((await ui.find({ type: 'Text', text: /leído 2 · editado 1/ }))?.text).toMatch(/leído 2 · editado 1/)
  await ui.unmount()
})
