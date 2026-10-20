import { expect, test } from 'claude-code/testing'

test('bloquea secretos y comandos peligrosos y deja pasar tras permitirlos', async ($, on) => {
  on('command.register', () => ({ value: { command: 'guardian' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1000 }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const limpio = await $.tool.call({ tool: 'Write', file_path: '/a.ts', content: 'const x = 1' })
  expect(limpio.deny).toBe(undefined)

  const clave = 'AKIA' + 'ABCDEFGHIJKLMNOP'
  const secreto = await $.tool.call({ tool: 'Write', file_path: '/a.ts', content: `const k = "${clave}"` })
  expect(secreto.deny).toMatch(/secreto/)

  const ejemplo = await $.tool.call({ tool: 'Write', file_path: '/.env.example', content: `K=${clave}` })
  expect(ejemplo.deny).toBe(undefined)

  const rm = await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
  expect(rm.deny).toMatch(/bloqueado/)
  const seguro = await $.tool.call({ tool: 'Bash', command: 'rm -rf node_modules' })
  expect(seguro.deny).toBe(undefined)
  const force = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(force.deny).toMatch(/bloqueado/)
  const lease = await $.tool.call({ tool: 'Bash', command: 'git push --force-with-lease' })
  expect(lease.deny).toBe(undefined)

  const ui = await $.ui.mount({
    plugin: 'guardian',
    component: 'Pane',
    requestId: 'guardian',
    surface: 'desktop',
    props: { title: 'Guardián', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  await ui.press({ key: 'ok-b1000-2' })
  await ui.unmount()

  const otraVez = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(otraVez.deny).toBe(undefined)
  const yaNo = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(yaNo.deny).toMatch(/bloqueado/)
})
