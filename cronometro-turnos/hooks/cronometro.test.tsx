import { expect, mock, test } from 'claude-code/testing'

test('cronometra la tarea y la guarda en el historial', async ($, on) => {
  mock.store(on)
  let ahora = 1_000_000
  on('command.register', () => ({ value: { command: 'tiempos' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: ahora }))
  on('clock.every', () => ({ value: { cancel: () => undefined } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Arregla el login' })
  await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/b.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'a', new_string: 'b' })
  ahora += 95_000
  await $.turn.complete({ answer: 'hecho', durationMs: 95_000, isAborted: false, turnId: 't', reason: 'answer' } as never)

  const ui = await $.ui.mount({
    plugin: 'cronometro-turnos',
    component: 'Pane',
    requestId: 'cronometro-turnos',
    surface: 'desktop',
    props: { title: 'Cronómetro', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  expect((await ui.find({ type: 'Text', text: /Arregla el login/ }))?.text).toBe('Arregla el login')
  expect((await ui.find({ type: 'Text', text: /3 herramientas/ }))?.text).toBe('3 herramientas · Read ×2')
  expect((await ui.find({ type: 'Text', text: /1 min 35 s/ }))?.text).toMatch(/1 min 35 s/)
  await ui.unmount()
})
