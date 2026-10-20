import { expect, mock, test } from 'claude-code/testing'

const ENTRADA = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never

test('las notas se guardan y viajan al prompt de sistema', async ($, on) => {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'pizarra' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.cwd', () => ({ value: '/proyecto' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'Hola', scope: 'shared' }] }))
  on('command.run', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const vacio = await $.prompt.compose(ENTRADA)
  expect(vacio.sections.length).toBe(1)

  await $.command.run({ command: 'pizarra', args: 'Usa pnpm, no npm' })
  await $.command.run({ command: 'pizarra', args: 'Responde en español' })
  const con = await $.prompt.compose(ENTRADA)
  expect(con.sections.length).toBe(2)
  expect(con.sections[1]?.text).toContain('- Usa pnpm, no npm\n- Responde en español')

  await $.command.run({ command: 'pizarra', args: 'off' })
  const apagada = await $.prompt.compose(ENTRADA)
  expect(apagada.sections.length).toBe(1)
})
