import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limite, Medida } from '../types'

const PANE = 'medidor-contexto'
const UMBRALES = [70, 85, 95]

const medida = atom({ plugin: 'medidor-contexto', key: 'medida' } as const, {
  tokens: null,
  ventana: 0,
  porcentaje: null,
  limites: [],
  avisados: [],
  umbral: 70,
} as Medida)

const NOMBRES: Record<string, string> = {
  five_hour: 'Límite de 5 horas',
  seven_day: 'Límite semanal',
  spend_limit: 'Límite de gasto',
}

const corto = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n))
const barra = (porcentaje: number, ancho: number) => {
  const llenos = Math.round((Math.min(100, Math.max(0, porcentaje)) / 100) * ancho)
  return '█'.repeat(llenos) + '░'.repeat(ancho - llenos)
}
const color = (p: number) => (p >= 85 ? 'error' : p >= 70 ? 'warning' : 'success')

function reinicio(iso: string | undefined, ahora: number) {
  if (!iso) return ''
  const falta = Math.max(0, Date.parse(iso) - ahora)
  const horas = Math.floor(falta / 3_600_000)
  const minutos = Math.floor((falta % 3_600_000) / 60_000)
  return horas >= 24 ? `se renueva en ${Math.floor(horas / 24)} d ${horas % 24} h` : `se renueva en ${horas} h ${minutos} min`
}

// Guarda la medida y avisa una sola vez al cruzar cada umbral.
async function anotar(
  $: EngineInterface,
  contexto: { tokens?: number; window: number; percent?: number },
  limites: readonly Limite[],
) {
  const porcentaje = contexto.percent ?? null
  const previo = await read($, medida)
  const cruzados = UMBRALES.filter(u => u >= previo.umbral && porcentaje !== null && porcentaje >= u)
  const nuevos = cruzados.filter(u => !previo.avisados.includes(u))
  const avisados = porcentaje === null ? previo.avisados : previo.avisados.filter(u => porcentaje >= u).concat(nuevos)

  await update($, medida, c => ({
    ...c,
    tokens: contexto.tokens ?? c.tokens,
    ventana: contexto.window,
    porcentaje,
    limites: limites.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    avisados,
  }))

  if (porcentaje !== null) {
    $.ui.status(`ctx ${Math.round(porcentaje)}%`)
  }
  const mayor = nuevos[nuevos.length - 1]
  if (mayor !== undefined) {
    $.ui.toast(
      mayor >= 95
        ? `Contexto al ${Math.round(porcentaje ?? mayor)}%: haz /compact o empieza una sesión nueva ya.`
        : `Contexto al ${Math.round(porcentaje ?? mayor)}%: conviene hacer /compact pronto.`,
    )
  }
}

async function fijarUmbral($: EngineInterface, umbral: number) {
  await update($, medida, c => ({ ...c, umbral, avisados: [] }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'contexto', description: 'Panel del contexto y de los límites de uso' })
    void $.ui.open({ id: PANE, title: 'Contexto y límites' })
    const { context, rateLimits } = await $.session.usage()
    await anotar($, context, rateLimits)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await anotar($, e.context, e.rateLimits)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'contexto' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Contexto y límites' })
    const m = await read($, medida)

    return {
      text:
        m.porcentaje === null
          ? 'Aún no hay medida del contexto.'
          : `Contexto: ${Math.round(m.porcentaje)}% (${corto(m.tokens ?? 0)} de ${corto(m.ventana)} tokens)`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const m = await read($, medida)
    const ahora = await $.clock.now()
    const ancho = Math.max(10, Math.min(32, (e.props.bodyColumns ?? 40) - 8))

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor>Contexto de la conversación</Text>
          {m.porcentaje === null ? (
            <Text dimColor>Se medirá tras la primera respuesta de Claude.</Text>
          ) : (
            <Box flexDirection="column">
              <Text size="title" weight="bold" tabular color={color(m.porcentaje)}>
                {Math.round(m.porcentaje)}%
              </Text>
              <Text color={color(m.porcentaje)}>{barra(m.porcentaje, ancho)}</Text>
              <Text dimColor tabular>
                {corto(m.tokens ?? 0)} de {corto(m.ventana)} tokens
              </Text>
              {m.porcentaje >= 85 && <Text color="error">Casi lleno: haz /compact o abre una sesión nueva.</Text>}
            </Box>
          )}
        </Box>

        {m.limites.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Text dimColor>Límites de uso de tu cuenta</Text>
            {m.limites.map(l => (
              <Box flexDirection="column">
                <Text bold>{NOMBRES[l.kind] ?? l.kind}</Text>
                <Text color={color(l.percentUsed)}>
                  {barra(l.percentUsed, ancho)} {Math.round(l.percentUsed)}%
                </Text>
                {l.resetsAt && <Text dimColor>{reinicio(l.resetsAt, ahora)}</Text>}
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          <Text dimColor>Avisarme desde el…</Text>
          <Box gap={1} flexWrap="wrap">
            {[50, 70, 85].map(u => (
              <Button
                key={`u${u}`}
                label={m.umbral === u ? `● ${u}%` : `${u}%`}
                onPress={() => fijarUmbral($, u)}
              />
            ))}
          </Box>
        </Box>
      </Box>
    )
  })
}
