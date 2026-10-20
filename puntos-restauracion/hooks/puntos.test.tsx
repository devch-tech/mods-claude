import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'puntos-restauracion',
  component: 'Pane',
  requestId: 'puntos-restauracion',
  props: {
    title: 'Puntos de restauración',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('copia el archivo antes de editarlo y lo restaura desde el panel', async ($, on) => {
  const disco = new Map<string, string>([['C:/p/a.txt', 'versión 1']])
  const borrados: string[] = []
  const n = (ruta: string) => ruta.split(String.fromCharCode(92)).join('/')
  mock.store(on)
  on('command.register', () => ({ value: { command: 'puntos' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', () => ({ value: 'C:/Users/x' }))
  on('clock.now', () => ({ value: 1_700_000_000_000 + disco.size }))
  on('fs.exists', (_, e) => ({ value: disco.has(n(e.path as string)) }))
  on('fs.read', (_, e) => ({ value: disco.get(n(e.path as string)) ?? '' }))
  on('fs.write', (_, e) => {
    disco.set(n(e.path as string), e.text as string)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    borrados.push(String((e.argv as string[]).at(-1)))
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: 'C:/p', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Cambia el título' })
  // La copia debe existir antes de que la herramienta (abajo) haga su trabajo.
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/a.txt', old_string: 'a', new_string: 'b' })
  disco.set('C:/p/a.txt', 'versión 2')
  await $.tool.call({ tool: 'Write', file_path: 'C:/p/nuevo.txt', content: 'hola' })
  disco.set('C:/p/nuevo.txt', 'hola')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Cambia el título/ }))?.text).toBe('Cambia el título')
  await ui.press({ key: 'volver-p1700000000001' })
  expect((await ui.find({ type: 'Text', text: /Volver aquí/ }))?.text).toMatch(/Volver aquí/)
  await ui.press({ key: 'si-p1700000000001' })
  await ui.unmount()

  expect(disco.get('C:/p/a.txt')).toBe('versión 1')
  expect(borrados.map(n)).toEqual(['C:/p/nuevo.txt'])
})
