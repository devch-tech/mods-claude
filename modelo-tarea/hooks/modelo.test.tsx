import { expect, mock, test } from 'claude-code/testing'

test('elige el modelo según la tarea y cambia a mitad de tarea', async ($, on) => {
  const pedidos: string[] = []
  mock.store(on)
  on('command.register', () => ({ value: { command: 'modelo' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('model.classify', () => ({ value: 'investigar y arreglar un error o un fallo' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('turn.step', async function* (_, e) {
    pedidos.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })

  const paso = async (index: number) => {
    const stream = $.turn.step({ turnId: 't1', index, model: 'claude-sonnet-5-5', messageCount: 1 })
    for await (const _ of stream) {
      // sin trozos: solo importa el modelo pedido
    }
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'El login falla con un 500, arréglalo' })
  await paso(0)
  expect(pedidos[0]).toBe('claude-opus-5-5')

  // Dos lecturas seguidas: pasa a explorar (Haiku).
  await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
  await $.tool.call({ tool: 'Grep', pattern: 'login' })
  await paso(1)
  expect(pedidos[1]).toBe('claude-haiku-5-5')

  // Modo fijo desde el comando.
  await $.command.run({ command: 'modelo', args: 'sonnet' })
  await paso(2)
  expect(pedidos[2]).toBe('claude-sonnet-5-5')
})
