import { expect, mock, test } from 'claude-code/testing'

const fin = (extra: object = {}) =>
  ({ answer: 'hecho', durationMs: 10, isAborted: false, turnId: 't', reason: 'answer', ...extra }) as never

test('la cola envía una tarea tras otra y se para si interrumpes', async ($, on) => {
  const enviados: string[] = []
  mock.store(on)
  on('command.register', () => ({ value: { command: 'cola' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 5 }))
  on('ui.toast', () => ({ value: undefined }))
  // La cola arranca con un clic en el panel (el comando lo difiere con un temporizador).
  on('clock.after', () => ({ value: {} }))
  const pulsarEmpezar = async () => {
    const ui = await $.ui.mount({
      plugin: 'cola-prompts',
      component: 'Pane',
      requestId: 'cola-prompts',
      surface: 'desktop',
      props: { title: 'Cola', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    } as never)
    await ui.press({ key: 'empezar' })
    await ui.unmount()
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'cola', args: 'Escribe los tests' })
  await $.command.run({ command: 'cola', args: 'Actualiza el README' })
  await $.command.run({ command: 'cola', args: 'Sube la versión' })
  expect(enviados.length).toBe(0)

  await pulsarEmpezar()
  expect(enviados).toEqual(['Escribe los tests'])

  await $.turn.complete(fin())
  expect(enviados).toEqual(['Escribe los tests', 'Actualiza el README'])

  // Interrumpir la tarea pausa la cola: la siguiente no sale.
  await $.turn.complete(fin({ isAborted: true, reason: 'aborted' }))
  expect(enviados.length).toBe(2)
  await $.turn.complete(fin())
  expect(enviados.length).toBe(2)

  await pulsarEmpezar()
  expect(enviados).toEqual(['Escribe los tests', 'Actualiza el README', 'Sube la versión'])
})
