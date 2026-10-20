import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pizarra } from '../types'

const PANE = 'pizarra'

const pizarra = atom({ plugin: 'pizarra', key: 'pizarra' } as const, {
  nota: '',
  isActiva: true,
  proyecto: '',
} as Pizarra)

// Una nota por proyecto: se guarda con la carpeta como clave.
const clave = (proyecto: string) => `nota:${proyecto.replace(/\\/g, '/')}`

async function guardar($: EngineInterface, cambio: (p: Pizarra) => Pizarra) {
  const p = await update($, pizarra, cambio)
  await $.store.set(clave(p.proyecto), { nota: p.nota, isActiva: p.isActiva })
}

async function anadir($: EngineInterface, linea: string) {
  const limpia = linea.trim()
  if (limpia === '') return
  await guardar($, p => ({ ...p, nota: p.nota === '' ? `- ${limpia}` : `${p.nota}\n- ${limpia}` }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const proyecto = await $.session.cwd()
    const guardada = (await $.store.get(clave(proyecto))) as { nota?: string; isActiva?: boolean } | undefined
    await update($, pizarra, p => ({
      ...p,
      proyecto,
      nota: typeof guardada?.nota === 'string' ? guardada.nota : '',
      isActiva: guardada?.isActiva !== false,
    }))
    await $.command.register({
      name: 'pizarra',
      description: 'Notas fijas para Claude: /pizarra texto · /pizarra borrar · /pizarra off|on',
    })
    void $.ui.open({ id: PANE, title: 'Pizarra' })

    return next(e)
  })

  // La nota va al final del prompt de sistema, en cada petición.
  on('prompt.compose', async ($, e, next) => {
    const resultado = await next(e)
    const p = await read($, pizarra)
    if (!p.isActiva || p.nota.trim() === '') return resultado

    return {
      sections: [
        ...resultado.sections,
        {
          id: 'pizarra:notas',
          scope: 'session' as const,
          text:
            'Notas fijadas por el usuario en su pizarra. Tenlas siempre en cuenta en esta sesión:\n' + p.nota.trim(),
        },
      ],
    }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'pizarra' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'borrar') {
      await guardar($, p => ({ ...p, nota: '' }))
      return { text: 'Pizarra vacía.' }
    }
    if (arg === 'off' || arg === 'on') {
      await guardar($, p => ({ ...p, isActiva: arg === 'on' }))
      return { text: arg === 'on' ? 'Claude volverá a leer la pizarra.' : 'Claude ya no lee la pizarra (la nota se conserva).' }
    }
    if (arg !== '') {
      await anadir($, arg)
      return { text: 'Añadido a la pizarra.' }
    }
    await $.ui.open({ id: PANE, title: 'Pizarra' })
    const p = await read($, pizarra)

    return { text: p.nota === '' ? 'La pizarra está vacía. Escribe /pizarra tu nota.' : `Pizarra (${p.isActiva ? 'activa' : 'apagada'}):\n${p.nota}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : null
    const p = await read($, pizarra)
    const lineas = p.nota === '' ? [] : p.nota.split('\n')

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text size="title" weight="bold">
            {lineas.length} {lineas.length === 1 ? 'nota' : 'notas'}
          </Text>
          <Text dimColor>
            {p.isActiva
              ? 'Claude las lee en cada petición de este proyecto.'
              : 'Apagada: Claude no las lee, pero se conservan.'}
          </Text>
        </Box>

        {lineas.length === 0 && <Text dimColor>Vacía. Añade lo que Claude no debe olvidar.</Text>}
        {lineas.map(linea => (
          <Text>{linea}</Text>
        ))}

        {Input && (
          <Input
            key="nueva"
            placeholder="Nueva nota (Enter para añadir)"
            submitLabel="añadir"
            onSubmit={v => void anadir($, v)}
          />
        )}

        <Box gap={1} flexWrap="wrap">
          <Button
            key="activa"
            label={p.isActiva ? '☑ Claude la lee' : '☐ Claude la lee'}
            onPress={() => guardar($, x => ({ ...x, isActiva: !x.isActiva }))}
          />
          {lineas.length > 0 && (
            <Button key="quitar" label="Quitar la última" onPress={() => guardar($, x => ({ ...x, nota: x.nota.split('\n').slice(0, -1).join('\n') }))} />
          )}
          {lineas.length > 0 && <Button key="borrar" label="Vaciar" onPress={() => guardar($, x => ({ ...x, nota: '' }))} />}
        </Box>
      </Box>
    )
  })
}
