import { expect, test } from 'claude-code/testing'

test('muestra el contexto, los límites y avisa una sola vez por umbral', async ($, on) => {
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'contexto' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: Date.parse('2026-10-20T10:00:00Z') }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { window: 200000, tokens: 20000, percent: 10 } },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const medir = (percent: number) =>
    $.session.measure({
      context: { window: 200000, tokens: percent * 2000, percent },
      rateLimits: [{ kind: 'five_hour', percentUsed: 41, resetsAt: '2026-10-20T12:30:00Z' }],
      changed: ['context'],
    } as never)

  await medir(60)
  expect(toasts.length).toBe(0)
  await medir(72)
  await medir(75)
  expect(toasts.length).toBe(1)
  await medir(88)
  expect(toasts.length).toBe(2)

  const ui = await $.ui.mount({
    plugin: 'medidor-contexto',
    component: 'Pane',
    requestId: 'medidor-contexto',
    surface: 'desktop',
    props: { title: 'Contexto', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  expect((await ui.find({ type: 'Text', text: /88%/ }))?.text).toBe('88%')
  expect((await ui.find({ type: 'Text', text: /5 horas/ }))?.text).toBe('Límite de 5 horas')
  expect((await ui.find({ type: 'Text', text: /se renueva/ }))?.text).toBe('se renueva en 2 h 30 min')
  await ui.unmount()
})
