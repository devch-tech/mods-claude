import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Modo, Selector, TipoTarea } from '../types'

const PANE = 'modelo-tarea'

const MODELOS = [
  { value: '', label: 'El de la sesión' },
  { value: 'claude-opus-5-5', label: 'Opus 5.5' },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { value: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { value: 'claude-fable-5-1', label: 'Fable 5.1' },
] as const

const TAREAS: { tipo: TipoTarea; nombre: string; pista: string }[] = [
  { tipo: 'planificar', nombre: 'Planificar', pista: 'planificar, diseñar arquitectura o decidir un enfoque' },
  { tipo: 'programar', nombre: 'Programar', pista: 'escribir o modificar código' },
  { tipo: 'depurar', nombre: 'Depurar', pista: 'investigar y arreglar un error o un fallo' },
  { tipo: 'explorar', nombre: 'Explorar', pista: 'buscar, leer o entender código o documentación' },
  { tipo: 'escribir', nombre: 'Redactar', pista: 'redactar texto, documentación o mensajes' },
  { tipo: 'rapida', nombre: 'Pregunta rápida', pista: 'pregunta corta o cambio trivial' },
]

const POR_DEFECTO: Selector = {
  modo: 'auto',
  modeloManual: 'claude-sonnet-5-5',
  mapa: {
    planificar: 'claude-opus-5-5',
    programar: 'claude-sonnet-5-5',
    depurar: 'claude-opus-5-5',
    explorar: 'claude-haiku-5-5',
    escribir: 'claude-sonnet-5-5',
    rapida: 'claude-haiku-5-5',
  },
  isAMitad: true,
  tarea: null,
  modeloActivo: '',
  cambios: [],
}

// Herramientas que delatan que Claude ha pasado a otro tipo de trabajo.
const FASE_POR_HERRAMIENTA: Record<string, TipoTarea> = {
  Read: 'explorar',
  Grep: 'explorar',
  Glob: 'explorar',
  WebFetch: 'explorar',
  WebSearch: 'explorar',
  Edit: 'programar',
  Write: 'programar',
  NotebookEdit: 'programar',
  EnterPlanMode: 'planificar',
  ExitPlanMode: 'planificar',
}

const selector = atom({ plugin: 'modelo-tarea', key: 'selector' } as const, POR_DEFECTO)

const nombreModelo = (id: string) =>
  MODELOS.find(m => m.value === id)?.label ?? (id === '' ? 'El de la sesión' : id)
const nombreTarea = (t: TipoTarea | null) =>
  TAREAS.find(x => x.tipo === t)?.nombre ?? 'sin detectar'

function objetivo(s: Selector): string {
  if (s.modo === 'manual') return s.modeloManual
  if (s.modo === 'auto' && s.tarea !== null) return s.mapa[s.tarea]
  return ''
}

// Guarda los ajustes (no el estado de la tarea) para próximas sesiones.
async function guardar($: EngineInterface, cambio: (s: Selector) => Selector) {
  const s = await update($, selector, cambio)
  await $.store.set('ajustes', {
    modo: s.modo,
    modeloManual: s.modeloManual,
    mapa: s.mapa,
    isAMitad: s.isAMitad,
  })
}

async function fijarTarea($: EngineInterface, tarea: TipoTarea) {
  await update($, selector, s => (s.tarea === tarea ? s : { ...s, tarea }))
}

export const register: Register = on => {
  let motivo = ''
  let pendiente: { fase: TipoTarea; veces: number } | null = null

  on('session.start', async ($, e, next) => {
    const guardado = (await $.store.get('ajustes')) as Partial<Selector> | undefined
    if (guardado) {
      await update($, selector, s => ({
        ...s,
        ...guardado,
        mapa: { ...POR_DEFECTO.mapa, ...guardado.mapa },
      }))
    }
    await $.command.register({
      name: 'modelo',
      description: 'Modelo por tarea: /modelo [auto | off | opus | sonnet | haiku | fable]',
    })
    void $.ui.open({ id: PANE, title: 'Modelo por tarea' })

    return next(e)
  })

  // Clasifica cada prompt nuevo del usuario en un tipo de tarea.
  on('prompt.submit', async ($, e, next) => {
    const s = await read($, selector)
    if (s.modo === 'auto' && e.command === undefined && e.isMeta === undefined && e.text.trim()) {
      const etiquetas = TAREAS.map(t => t.pista)
      const pista = await $.model.classify(e.text.slice(0, 4000), etiquetas)
      const tarea = TAREAS.find(t => t.pista === pista)?.tipo
      if (tarea) {
        motivo = `prompt: ${nombreTarea(tarea).toLowerCase()}`
        pendiente = null
        await fijarTarea($, tarea)
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // A mitad de tarea: si Claude usa dos veces seguidas herramientas de otro tipo, cambia.
  on('tool.call', async ($, e, next) => {
    const fase = e.agentId === undefined ? FASE_POR_HERRAMIENTA[e.tool] : undefined
    if (fase) {
      const s = await read($, selector)
      if (s.modo === 'auto' && s.isAMitad && fase !== s.tarea) {
        pendiente = pendiente?.fase === fase ? { fase, veces: pendiente.veces + 1 } : { fase, veces: 1 }
        if (pendiente.veces >= 2) {
          motivo = `usa ${e.tool}: ${nombreTarea(fase).toLowerCase()}`
          pendiente = null
          await fijarTarea($, fase)
        }
      } else {
        pendiente = null
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Cada petición del hilo principal sale con el modelo elegido.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    const s = await read($, selector)
    const model = objetivo(s) || e.model
    if (model !== s.modeloActivo) {
      const de = s.modeloActivo || e.model
      await update($, selector, x => ({
        ...x,
        modeloActivo: model,
        cambios:
          de === model
            ? x.cambios
            : [{ de, a: model, motivo: motivo || x.modo }, ...x.cambios].slice(0, 6),
      }))
      if (de !== model) {
        $.ui.toast(`Modelo: ${nombreModelo(de)} → ${nombreModelo(model)}`)
      }
    }
    $.ui.status(`🧠 ${nombreModelo(model)}`)

    return yield* next(model === e.model ? e : { ...e, model })
  })

  on('command.run', { command: 'modelo' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const porNombre = MODELOS.find(m => m.value !== '' && m.label.toLowerCase().startsWith(arg))

    if (arg === 'auto' || arg === 'off') {
      await guardar($, s => ({ ...s, modo: arg as Modo }))
      return { text: arg === 'auto' ? 'Modelo por tarea: automático.' : 'Modelo por tarea: apagado.' }
    }
    if (arg !== '' && porNombre) {
      await guardar($, s => ({ ...s, modo: 'manual', modeloManual: porNombre.value }))
      return { text: `Modelo fijo: ${porNombre.label}.` }
    }
    if (arg !== '') {
      return { text: 'Uso: /modelo auto · /modelo off · /modelo opus|sonnet|haiku|fable' }
    }

    await $.ui.open({ id: PANE, title: 'Modelo por tarea' })
    const s = await read($, selector)
    return {
      text: `Modo ${s.modo} · tarea ${nombreTarea(s.tarea)} · modelo ${nombreModelo(s.modeloActivo || (await $.session.model()))}`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Select = 'Select' in els ? els.Select : null
    const s = await read($, selector)
    const activo = s.modeloActivo || (await $.session.model())

    const elegirModelo = (key: string, value: string, alElegir: (v: string) => void) =>
      Select ? (
        <Select key={key} options={MODELOS} value={value} onSelect={alElegir} />
      ) : (
        <Button
          key={key}
          label={nombreModelo(value)}
          onPress={() => {
            const i = MODELOS.findIndex(m => m.value === value)
            alElegir(MODELOS[(i + 1) % MODELOS.length]?.value ?? '')
          }}
        />
      )

    const MODOS: { modo: Modo; label: string }[] = [
      { modo: 'auto', label: 'Automático' },
      { modo: 'manual', label: 'Fijo' },
      { modo: 'off', label: 'Apagado' },
    ]

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor>Modelo en uso</Text>
          <Text size="title" weight="bold" color="claude">
            {nombreModelo(activo)}
          </Text>
          {s.modo === 'auto' && <Text dimColor>Tarea detectada: {nombreTarea(s.tarea)}</Text>}
        </Box>

        <Box gap={1} flexWrap="wrap">
          {MODOS.map(m => (
            <Button
              key={`modo-${m.modo}`}
              label={s.modo === m.modo ? `● ${m.label}` : m.label}
              onPress={() => guardar($, x => ({ ...x, modo: m.modo }))}
            />
          ))}
        </Box>

        {s.modo === 'manual' && (
          <Box flexDirection="column">
            <Text dimColor>Usar siempre</Text>
            {elegirModelo('manual', s.modeloManual, v => void guardar($, x => ({ ...x, modeloManual: v })))}
          </Box>
        )}

        {s.modo === 'auto' && (
          <Box flexDirection="column" gap={1}>
            <Text dimColor>Modelo para cada tipo de tarea</Text>
            {TAREAS.map(t => (
              <Box flexDirection="column">
                <Text bold={s.tarea === t.tipo}>
                  {s.tarea === t.tipo ? '▸ ' : ''}
                  {t.nombre}
                </Text>
                {elegirModelo(`mapa-${t.tipo}`, s.mapa[t.tipo], v =>
                  void guardar($, x => ({ ...x, mapa: { ...x.mapa, [t.tipo]: v } })),
                )}
              </Box>
            ))}
            <Button
              key="a-mitad"
              label={s.isAMitad ? '☑ Cambiar también a mitad de tarea' : '☐ Cambiar también a mitad de tarea'}
              onPress={() => guardar($, x => ({ ...x, isAMitad: !x.isAMitad }))}
            />
          </Box>
        )}

        {s.cambios.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Últimos cambios</Text>
            {s.cambios.map(c => (
              <Text wrap="truncate-end">
                {nombreModelo(c.de)} → {nombreModelo(c.a)} <Text dimColor>({c.motivo})</Text>
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
