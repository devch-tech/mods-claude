import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cola, Pendiente } from '../types'

const PANE = 'cola-prompts'

const cola = atom({ plugin: 'cola-prompts', key: 'cola' } as const, {
  pendientes: [],
  isActiva: false,
  enviadas: 0,
  mensaje: '',
} as Cola)

let contador = 0

async function guardar($: EngineInterface) {
  const { pendientes } = await read($, cola)
  await $.store.set('pendientes', pendientes)
}

async function anadir($: EngineInterface, texto: string) {
  const limpio = texto.trim()
  if (limpio === '') return
  contador += 1
  const nuevo: Pendiente = { id: `c${await $.clock.now()}-${contador}`, texto: limpio }
  await update($, cola, c => ({ ...c, pendientes: [...c.pendientes, nuevo], mensaje: '' }))
  await guardar($)
}

async function quitar($: EngineInterface, id: string) {
  await update($, cola, c => ({ ...c, pendientes: c.pendientes.filter(p => p.id !== id) }))
  await guardar($)
}

async function subir($: EngineInterface, id: string) {
  await update($, cola, c => {
    const i = c.pendientes.findIndex(p => p.id === id)
    if (i <= 0) return c
    const lista = [...c.pendientes]
    const anterior = lista[i - 1]
    const actual = lista[i]
    if (anterior && actual) {
      lista[i - 1] = actual
      lista[i] = anterior
    }
    return { ...c, pendientes: lista }
  })
  await guardar($)
}

// Saca la primera tarea de la cola y la envía como si la escribieras tú.
async function enviarSiguiente($: EngineInterface) {
  const c = await read($, cola)
  const siguiente = c.pendientes[0]
  if (!siguiente) {
    await update($, cola, x => ({ ...x, isActiva: false, mensaje: 'Cola terminada.' }))
    $.ui.toast('Cola de prompts terminada')
    return
  }
  await update($, cola, x => ({
    ...x,
    isActiva: true,
    enviadas: x.enviadas + 1,
    mensaje: '',
    pendientes: x.pendientes.slice(1),
  }))
  await guardar($)
  void $.prompt.submit({ text: siguiente.texto, asUser: true })
}

async function empezar($: EngineInterface) {
  await update($, cola, c => ({ ...c, enviadas: 0 }))
  await enviarSiguiente($)
}

async function parar($: EngineInterface, motivo: string) {
  await update($, cola, c => ({ ...c, isActiva: false, mensaje: motivo }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const guardados = await $.store.get('pendientes')
    if (Array.isArray(guardados)) {
      await update($, cola, c => ({ ...c, pendientes: guardados as Pendiente[] }))
    }
    await $.command.register({
      name: 'cola',
      description: 'Cola de prompts: /cola texto · /cola empezar · /cola parar · /cola vaciar',
    })
    void $.ui.open({ id: PANE, title: 'Cola de prompts' })

    return next(e)
  })

  // Al acabar cada respuesta, la cola envía la siguiente tarea.
  on('turn.complete', async ($, e, next) => {
    const c = await read($, cola)
    if (e.agentId === undefined && c.isActiva) {
      if (e.isAborted) {
        await parar($, 'Cola en pausa: interrumpiste la tarea.')
        $.ui.toast('Cola en pausa')
      } else if (e.reason === 'answer') {
        await enviarSiguiente($)
      } else {
        await parar($, 'Cola en pausa: la tarea terminó con un error.')
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'cola' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'empezar') {
      // prompt.submit no puede salir desde dentro del comando: se envía justo después.
      $.clock.after(100, () => void empezar($))
      return { text: 'Cola en marcha.' }
    }
    if (arg === 'parar') {
      await parar($, 'Cola en pausa.')
      return { text: 'Cola en pausa.' }
    }
    if (arg === 'vaciar') {
      await update($, cola, c => ({ ...c, pendientes: [], isActiva: false }))
      await guardar($)
      return { text: 'Cola vacía.' }
    }
    if (arg !== '') {
      await anadir($, arg)
      return { text: 'Añadido a la cola. Usa /cola empezar cuando quieras que arranque.' }
    }
    await $.ui.open({ id: PANE, title: 'Cola de prompts' })
    const c = await read($, cola)

    return { text: `${c.pendientes.length} en la cola · ${c.isActiva ? 'en marcha' : 'parada'}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : null
    const c = await read($, cola)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text size="title" weight="bold" color={c.isActiva ? 'success' : undefined}>
            {c.isActiva ? '▶ En marcha' : '⏸ Parada'}
          </Text>
          <Text dimColor>
            {c.pendientes.length} pendientes
            {c.enviadas > 0 ? ` · ${c.enviadas} enviadas` : ''}
          </Text>
          {c.mensaje !== '' && <Text color="warning">{c.mensaje}</Text>}
        </Box>

        {Input && (
          <Input
            key="nuevo"
            placeholder="Escribe una tarea y pulsa Enter"
            submitLabel="a la cola"
            rows={2}
            onSubmit={v => void anadir($, v)}
          />
        )}

        <Box gap={1} flexWrap="wrap">
          {c.isActiva ? (
            <Button key="parar" label="Pausar" onPress={() => parar($, 'Cola en pausa.')} />
          ) : (
            c.pendientes.length > 0 && <Button key="empezar" label="Empezar" hotkey="e" onPress={() => empezar($)} />
          )}
          {c.pendientes.length > 0 && (
            <Button
              key="vaciar"
              label="Vaciar"
              onPress={async () => {
                await update($, cola, x => ({ ...x, pendientes: [], isActiva: false }))
                await guardar($)
              }}
            />
          )}
        </Box>

        {c.pendientes.length === 0 && <Text dimColor>La cola está vacía.</Text>}
        {c.pendientes.map((p, i) => (
          <Box flexDirection="column" key={p.id}>
            <Text wrap="truncate-end" bold={i === 0}>
              {i + 1}. {p.texto}
            </Text>
            <Box gap={1}>
              {i > 0 && <Button key={`sube-${p.id}`} label="Subir" onPress={() => subir($, p.id)} />}
              <Button key={`quita-${p.id}`} label="Quitar" onPress={() => quitar($, p.id)} />
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
