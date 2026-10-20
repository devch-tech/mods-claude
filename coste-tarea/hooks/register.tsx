import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Coste } from '../types'

const PANE = 'coste-tarea'
const PRESETS = [0.5, 1, 2, 5, 10]

const coste = atom({ plugin: 'coste-tarea', key: 'coste' } as const, {
  sesionUsd: 0,
  inicioTareaUsd: 0,
  titulo: '',
  presupuestoUsd: null,
  extraUsd: 0,
  isPausada: false,
  historial: [],
} as Coste)

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`
const gastado = (c: Coste) => Math.max(0, c.sesionUsd - c.inicioTareaUsd)
const limite = (c: Coste) =>
  c.presupuestoUsd === null ? null : c.presupuestoUsd + c.extraUsd

const barra = (fraccion: number, ancho = 20) => {
  const llenos = Math.round(Math.min(1, fraccion) * ancho)
  return '█'.repeat(llenos) + '░'.repeat(ancho - llenos)
}

// Lee el coste de la sesión y lo guarda; devuelve el estado nuevo.
async function medir($: EngineInterface) {
  const { cost } = await $.session.usage()
  return update($, coste, c => ({ ...c, sesionUsd: cost?.usd ?? c.sesionUsd }))
}

async function fijarPresupuesto($: EngineInterface, valor: number | null) {
  await $.store.set('presupuestoUsd', valor)
  await update($, coste, c => ({ ...c, presupuestoUsd: valor, extraUsd: 0, isPausada: false }))
}

// Concede otro tramo igual al presupuesto, contado desde lo ya gastado.
async function continuar($: EngineInterface) {
  await update($, coste, c => ({ ...c, extraUsd: gastado(c), isPausada: false }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const guardado = await $.store.get('presupuestoUsd')
    const presupuestoUsd = typeof guardado === 'number' ? guardado : null
    const { cost } = await $.session.usage()
    const sesionUsd = cost?.usd ?? 0
    await update($, coste, c => ({
      ...c,
      presupuestoUsd,
      sesionUsd,
      inicioTareaUsd: c.titulo === '' ? sesionUsd : c.inicioTareaUsd,
    }))
    await $.command.register({
      name: 'coste',
      description: 'Coste por tarea: /coste [importe | off | continuar]',
    })
    void $.ui.open({ id: PANE, title: 'Coste por tarea' })

    return next(e)
  })

  // Cada prompt nuevo del usuario es una tarea nueva.
  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined && e.isMeta === undefined) {
      const { cost } = await $.session.usage()
      const ahora = cost?.usd ?? 0
      await update($, coste, c => ({
        ...c,
        historial:
          c.titulo === ''
            ? c.historial
            : [{ titulo: c.titulo, usd: ahora - c.inicioTareaUsd }, ...c.historial].slice(0, 8),
        sesionUsd: ahora,
        inicioTareaUsd: ahora,
        titulo: e.text.replace(/\s+/g, ' ').trim().slice(0, 60),
        extraUsd: 0,
        isPausada: false,
      }))
      $.ui.status(undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const c = await medir($)
    const tope = limite(c)

    if (tope !== null && gastado(c) >= tope) {
      if (!c.isPausada) {
        await update($, coste, x => ({ ...x, isPausada: true }))
        $.ui.toast(`Presupuesto alcanzado: ${usd(gastado(c))} de ${usd(tope)}`)
        $.ui.status(`⏸ coste ${usd(gastado(c))}/${usd(tope)}`)
      }

      return {
        deny:
          `Presupuesto de la tarea alcanzado (${usd(gastado(c))} de ${usd(tope)}). ` +
          'No llames a más herramientas: resume en una frase lo hecho y lo que falta, ' +
          'y espera a que el usuario pulse "Continuar" o suba el presupuesto con /coste.',
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    if (e.cost) {
      await update($, coste, c => ({ ...c, sesionUsd: e.cost?.usd ?? c.sesionUsd }))
    }

    return next(e)
  })

  on('command.run', { command: 'coste' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase().replace(',', '.').replace('$', '')

    if (arg === 'off' || arg === 'sin') {
      await fijarPresupuesto($, null)
      return { text: 'Presupuesto por tarea desactivado.' }
    }
    if (arg === 'continuar' || arg === 'seguir') {
      await continuar($)
      return { text: 'Tarea reanudada con otro tramo de presupuesto.' }
    }
    if (arg !== '') {
      const valor = Number(arg)
      if (!Number.isFinite(valor) || valor <= 0) {
        return { text: 'Uso: /coste 2.5 · /coste off · /coste continuar' }
      }
      await fijarPresupuesto($, valor)
      return { text: `Presupuesto por tarea: ${usd(valor)}.` }
    }

    await $.ui.open({ id: PANE, title: 'Coste por tarea' })
    const c = await medir($)
    const tope = limite(c)
    return {
      text:
        `Tarea: ${usd(gastado(c))}` +
        (tope === null ? ' (sin presupuesto)' : ` de ${usd(tope)}`) +
        ` · Sesión: ${usd(c.sesionUsd)}`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : null
    const c = await read($, coste)
    const tope = limite(c)
    const g = gastado(c)
    const fraccion = tope === null || tope === 0 ? 0 : g / tope
    const color = c.isPausada ? 'error' : fraccion >= 0.8 ? 'warning' : 'success'
    const ancho = Math.max(8, Math.min(30, (e.props.bodyColumns ?? 40) - 12))

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor>Tarea actual</Text>
          <Text bold wrap="truncate-end">
            {c.titulo === '' ? 'Aún no hay tarea' : c.titulo}
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text size="title" weight="bold" tabular color={color}>
            {usd(g)}
            {tope === null ? '' : ` / ${usd(tope)}`}
          </Text>
          {tope !== null && (
            <Text color={color}>
              {barra(fraccion, ancho)} {Math.round(fraccion * 100)}%
            </Text>
          )}
          {c.isPausada && (
            <Text color="error" bold>
              ⏸ Pausada: herramientas bloqueadas por presupuesto
            </Text>
          )}
          <Text dimColor tabular>
            Sesión: {usd(c.sesionUsd)}
          </Text>
        </Box>

        {c.isPausada && (
          <Box gap={1}>
            <Button key="continuar" label="Continuar otro tramo" hotkey="c" onPress={() => continuar($)} />
            <Button key="quitar" label="Quitar límite" onPress={() => fijarPresupuesto($, null)} />
          </Box>
        )}

        <Box flexDirection="column">
          <Text dimColor>
            Presupuesto por tarea: {c.presupuestoUsd === null ? 'sin límite' : usd(c.presupuestoUsd)}
          </Text>
          <Box gap={1} flexWrap="wrap">
            {PRESETS.map(p => (
              <Button key={`p${p}`} label={`$${p}`} onPress={() => fijarPresupuesto($, p)} />
            ))}
            <Button key="off" label="Sin límite" onPress={() => fijarPresupuesto($, null)} />
          </Box>
          {Input && (
            <Input
              key="importe"
              placeholder="Otro importe (USD)"
              submitLabel="fijar"
              onSubmit={valor => {
                const n = Number(valor.replace(',', '.').replace('$', '').trim())
                if (Number.isFinite(n) && n > 0) void fijarPresupuesto($, n)
              }}
            />
          )}
        </Box>

        {c.historial.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Tareas anteriores</Text>
            {c.historial.map(t => (
              <Text wrap="truncate-end" tabular>
                {usd(t.usd).padStart(7)} {t.titulo}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
