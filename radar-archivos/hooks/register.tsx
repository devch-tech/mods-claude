import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Radar } from '../types'

const PANE = 'radar-archivos'
const MAX_FILAS = 40

const radar = atom({ plugin: 'radar-archivos', key: 'radar' } as const, {
  archivos: [],
  raiz: '',
  soloEditados: false,
} as Radar)

const norm = (ruta: string) => ruta.replace(/\\/g, '/')

function relativa(ruta: string, raiz: string) {
  const r = norm(ruta)
  const base = norm(raiz).replace(/\/$/, '')
  return base !== '' && r.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? r.slice(base.length + 1) : r
}

async function marcar($: EngineInterface, ruta: string, tipo: 'lectura' | 'edicion') {
  const ahora = await $.clock.now()
  const clave = norm(ruta)
  await update($, radar, c => {
    const previo = c.archivos.find(a => a.ruta === clave)
    const nuevo = {
      ruta: clave,
      lecturas: (previo?.lecturas ?? 0) + (tipo === 'lectura' ? 1 : 0),
      ediciones: (previo?.ediciones ?? 0) + (tipo === 'edicion' ? 1 : 0),
      ultimo: ahora,
    }
    return { ...c, archivos: [nuevo, ...c.archivos.filter(a => a.ruta !== clave)] }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const raiz = await $.session.cwd()
    await update($, radar, c => ({ ...c, raiz }))
    await $.command.register({ name: 'archivos', description: 'Radar: qué archivos ha leído y editado Claude' })
    void $.ui.open({ id: PANE, title: 'Radar de archivos' })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Read') await marcar($, e.file_path, 'lectura')
    else if (e.tool === 'Edit' || e.tool === 'Write') await marcar($, e.file_path, 'edicion')
    else if (e.tool === 'NotebookEdit') await marcar($, e.notebook_path, 'edicion')

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'archivos' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Radar de archivos' })
    const { archivos } = await read($, radar)
    const editados = archivos.filter(a => a.ediciones > 0).length

    return { text: `${archivos.length} archivos tocados · ${editados} editados` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = await read($, radar)
    const editados = c.archivos.filter(a => a.ediciones > 0)
    const lista = (c.soloEditados ? editados : c.archivos)
      .slice()
      .sort((a, b) => b.ediciones - a.ediciones || b.lecturas - a.lecturas || b.ultimo - a.ultimo)
    const visibles = lista.slice(0, MAX_FILAS)
    const maximo = Math.max(1, ...lista.map(a => a.ediciones + a.lecturas))

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text size="title" weight="bold" tabular>
            {c.archivos.length} {c.archivos.length === 1 ? 'archivo' : 'archivos'}
          </Text>
          <Text dimColor>
            {editados.length} editados · {c.archivos.length - editados.length} solo leídos
          </Text>
        </Box>

        <Box gap={1} flexWrap="wrap">
          <Button
            key="todos"
            label={c.soloEditados ? 'Todos' : '● Todos'}
            onPress={() => update($, radar, x => ({ ...x, soloEditados: false }))}
          />
          <Button
            key="editados"
            label={c.soloEditados ? '● Solo editados' : 'Solo editados'}
            onPress={() => update($, radar, x => ({ ...x, soloEditados: true }))}
          />
          <Button key="limpiar" label="Limpiar" onPress={() => update($, radar, x => ({ ...x, archivos: [] }))} />
        </Box>

        {visibles.length === 0 && <Text dimColor>Aún no se ha tocado ningún archivo.</Text>}

        {visibles.map(a => (
          <Box flexDirection="column" key={a.ruta}>
            <Text wrap="truncate-start" bold={a.ediciones > 0}>
              {relativa(a.ruta, c.raiz)}
            </Text>
            <Text tabular>
              <Text color={a.ediciones > 0 ? 'warning' : undefined} dimColor={a.ediciones === 0}>
                {'█'.repeat(Math.max(1, Math.round(((a.ediciones + a.lecturas) / maximo) * 12)))}
              </Text>
              <Text dimColor>
                {' '}
                {a.lecturas > 0 ? `leído ${a.lecturas}` : ''}
                {a.lecturas > 0 && a.ediciones > 0 ? ' · ' : ''}
                {a.ediciones > 0 ? `editado ${a.ediciones}` : ''}
              </Text>
            </Text>
          </Box>
        ))}
        {lista.length > MAX_FILAS && <Text dimColor>… y {lista.length - MAX_FILAS} más</Text>}
      </Box>
    )
  })
}
