import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'coste-tarea',
  component: 'Pane',
  requestId: 'coste-tarea',
  props: {
    title: 'Coste por tarea',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('pausa las herramientas al llegar al presupuesto de la tarea', async ($, on) => {
  let usd = 0.2
  mock.store(on)
  on('command.register', () => ({ value: { command: 'coste' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd } },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('command.run', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'coste', args: '1' })
  await $.prompt.submit({ text: 'Refactoriza el login' })

  usd = 0.9
  const antes = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(antes.deny).toBe(undefined)

  usd = 1.3
  const despues = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(despues.deny).toMatch(/Presupuesto de la tarea alcanzado/)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Pausada/ }))?.text).toMatch(/Pausada/)
  await ui.press({ key: 'continuar' })
  await ui.unmount()

  const reanudada = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(reanudada.deny).toBe(undefined)
})
