import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cronometro, Tarea } from '../types'

const PANE = 'cronometro-turnos'

const cronometro = atom({ plugin: 'cronometro-turnos', key: 'cronometro' } as const, {
  tareas: [],
  avisoSegundos: 120,
  tic: 0,
} as Cronometro)

// Cuenta de herramientas de la tarea en curso; vive en el módulo.
const usos: { porNombre: Record<string, number>; avisada: boolean } = { porNombre: {}, avisada: false }
let tempo: { cancel: () => void } | null = null

function formato(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`
}

const hora = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

function principal() {
  const orden = Object.entries(usos.porNombre).sort((a, b) => b[1] - a[1])
  const top = orden[0]
  return top ? `${top[0]} ×${top[1]}` : '—'
}

async function fijarAviso($: EngineInterface, segundos: number) {
  await $.store.set('avisoSegundos', segundos)
  await update($, cronometro, c => ({ ...c, avisoSegundos: segundos }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const guardado = await $.store.get('avisoSegundos')
    if (typeof guardado === 'number') await update($, cronometro, c => ({ ...c, avisoSegundos: guardado }))
    await $.command.register({ name: 'tiempos', description: 'Cronómetro de tareas: cuánto tarda cada una' })
    void $.ui.open({ id: PANE, title: 'Cronómetro' })

    return next(e)
  })

  // Un prompt tuyo abre una tarea nueva y pone en marcha el reloj del panel.
  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined && e.isMeta === undefined && e.text.trim()) {
      const ahora = await $.clock.now()
      usos.porNombre = {}
      usos.avisada = false
      const tarea: Tarea = {
        id: `t${ahora}`,
        prompt: e.text.replace(/\s+/g, ' ').trim().slice(0, 120),
        inicio: ahora,
        duracion: null,
        herramientas: 0,
        principal: '—',
        isInterrumpida: false,
      }
      await update($, cronometro, c => ({ ...c, tareas: [tarea, ...c.tareas].slice(0, 20), tic: ahora }))

      tempo?.cancel()
      tempo = $.clock.every(1000, () => {
        void (async () => {
          const t = await $.clock.now()
          const c = await read($, cronometro)
          const abierta = c.tareas[0]
          if (!abierta || abierta.duracion !== null) return
          await update($, cronometro, x => ({ ...x, tic: t }))
          if (c.avisoSegundos > 0 && !usos.avisada && t - abierta.inicio >= c.avisoSegundos * 1000) {
            usos.avisada = true
            $.ui.toast(`Esta tarea ya lleva ${formato(t - abierta.inicio)}`)
          }
        })()
      })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) {
      usos.porNombre[e.tool] = (usos.porNombre[e.tool] ?? 0) + 1
      await update($, cronometro, c => ({
        ...c,
        tareas: c.tareas.map((t, i) =>
          i === 0 && t.duracion === null ? { ...t, herramientas: t.herramientas + 1, principal: principal() } : t,
        ),
      }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      tempo?.cancel()
      tempo = null
      await update($, cronometro, c => ({
        ...c,
        tareas: c.tareas.map((t, i) =>
          i === 0 && t.duracion === null ? { ...t, duracion: e.durationMs, isInterrumpida: e.isAborted } : t,
        ),
      }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'tiempos' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Cronómetro' })
    const c = await read($, cronometro)
    const hechas = c.tareas.filter(t => t.duracion !== null)
    const total = hechas.reduce((suma, t) => suma + (t.duracion ?? 0), 0)

    return { text: `${hechas.length} tareas terminadas · ${formato(total)} en total` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = await read($, cronometro)
    const ahora = c.tic || (await $.clock.now())
    const actual = c.tareas[0]
    const enCurso = actual !== undefined && actual.duracion === null
    const hechas = c.tareas.filter(t => t.duracion !== null)
    const media = hechas.length ? hechas.reduce((s, t) => s + (t.duracion ?? 0), 0) / hechas.length : 0

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor>{enCurso ? 'Tarea en curso' : 'Sin tarea en curso'}</Text>
          {enCurso && actual && (
            <Box flexDirection="column">
              <Text size="title" weight="bold" tabular color="claude">
                {formato(ahora - actual.inicio)}
              </Text>
              <Text wrap="truncate-end">{actual.prompt}</Text>
              <Text dimColor>
                {actual.herramientas} herramientas · {actual.principal}
              </Text>
            </Box>
          )}
          {hechas.length > 0 && (
            <Text dimColor tabular>
              {hechas.length} terminadas · media {formato(media)}
            </Text>
          )}
        </Box>

        <Box flexDirection="column">
          <Text dimColor>Avisarme si una tarea pasa de…</Text>
          <Box gap={1} flexWrap="wrap">
            {[60, 120, 300, 600, 0].map(s => (
              <Button
                key={`a${s}`}
                label={c.avisoSegundos === s ? `● ${s === 0 ? 'Nunca' : formato(s * 1000)}` : s === 0 ? 'Nunca' : formato(s * 1000)}
                onPress={() => fijarAviso($, s)}
              />
            ))}
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text dimColor>Historial</Text>
          {hechas.length === 0 && <Text dimColor>Aún no hay tareas terminadas.</Text>}
          {hechas.map(t => (
            <Box flexDirection="column" key={t.id}>
              <Text bold tabular>
                {formato(t.duracion ?? 0)} <Text dimColor>{hora(t.inicio)}</Text>
                {t.isInterrumpida ? <Text color="warning"> · interrumpida</Text> : null}
              </Text>
              <Text wrap="truncate-end">{t.prompt}</Text>
              <Text dimColor>
                {t.herramientas} herramientas · {t.principal}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
