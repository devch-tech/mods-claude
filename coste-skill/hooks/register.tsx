import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CosteSkill, FilaSkill, Orden } from '../types'

const PANE = 'coste-skill'
const MAX_FILAS = 60

const coste = atom({ plugin: 'coste-skill', key: 'coste' } as const, {
  filas: [],
  medidos: {},
  totalSkills: 0,
  incluidas: 0,
  tokensListado: 0,
  precioMillon: 3,
  filtro: '',
  orden: 'cuerpo',
  isCargando: false,
} as CosteSkill)

// Estimación gruesa: ~4 caracteres por token.
const tokensDe = (texto: string) => Math.ceil(texto.length / 4)
const sinFrontmatter = (md: string) => md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
const corto = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const usd = (tokens: number, precio: number) => {
  const v = (tokens * precio) / 1_000_000
  return v < 0.001 ? '<$0.001' : `$${v.toFixed(v < 0.1 ? 4 : 3)}`
}

async function leer($: EngineInterface, ruta: string): Promise<string | null> {
  try {
    return await $.fs.read(ruta)
  } catch {
    return null
  }
}

async function listar($: EngineInterface, ruta: string): Promise<string[]> {
  try {
    const entradas = await $.fs.list(ruta)
    return entradas.filter(x => x.kind === 'dir').map(x => x.name)
  } catch {
    return []
  }
}

// Busca el SKILL.md de una skill en las carpetas habituales; null si no lo halla.
async function buscarCuerpo(
  $: EngineInterface,
  nombre: string,
  origen: string,
  plugin: string | undefined,
): Promise<number | null> {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  const cwd = (await $.session.cwd()).replace(/\\/g, '/')
  const simple = nombre.includes(':') ? nombre.slice(nombre.lastIndexOf(':') + 1) : nombre
  const candidatos: string[] = []

  if (origen === 'userSettings') candidatos.push(`${home}/.claude/skills/${simple}/SKILL.md`)
  if (origen === 'projectSettings') candidatos.push(`${cwd}/.claude/skills/${simple}/SKILL.md`)
  if (origen === 'plugin' && plugin) {
    const cache = `${home}/.claude/plugins/cache`
    for (const mercado of await listar($, cache)) {
      const versiones = await listar($, `${cache}/${mercado}/${plugin}`)
      for (const v of versiones.reverse()) {
        candidatos.push(`${cache}/${mercado}/${plugin}/${v}/skills/${simple}/SKILL.md`)
      }
    }
  }

  for (const ruta of candidatos) {
    const md = await leer($, ruta)
    if (md !== null) return tokensDe(sinFrontmatter(md))
  }
  return null
}

// Lee el listado de skills de la sesión y mide el cuerpo de cada una.
async function cargar($: EngineInterface) {
  await update($, coste, c => ({ ...c, isCargando: true }))
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const skills = context.breakdown?.skills
  const previo = await read($, coste)
  const filas: FilaSkill[] = []

  for (const s of skills?.skillFrontmatter ?? []) {
    const medido = previo.medidos[s.name]
    const cuerpo = medido ?? (await buscarCuerpo($, s.name, s.source, s.pluginName))
    filas.push({
      name: s.name,
      origen: s.source,
      pluginName: s.pluginName,
      listado: s.tokens,
      cuerpo,
      isMedido: medido !== undefined,
    })
  }

  await update($, coste, c => ({
    ...c,
    // Una skill invocada mientras se leía conserva su medida real.
    filas: filas.map(f => {
      const medido = c.medidos[f.name]
      return medido === undefined ? f : { ...f, cuerpo: medido, isMedido: true }
    }),
    totalSkills: skills?.totalSkills ?? filas.length,
    incluidas: skills?.includedSkills ?? filas.length,
    tokensListado: skills?.tokens ?? 0,
    isCargando: false,
  }))
}

async function fijarPrecio($: EngineInterface, precio: number) {
  await $.store.set('precioMillon', precio)
  await update($, coste, c => ({ ...c, precioMillon: precio }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const precio = await $.store.get('precioMillon')
    if (typeof precio === 'number') {
      await update($, coste, c => ({ ...c, precioMillon: precio }))
    }
    await $.command.register({
      name: 'coste-skill',
      description: 'Skills y su coste estimado: /coste-skill [filtro]',
    })
    void $.ui.open({ id: PANE, title: 'Coste por skill' })
    void cargar($).catch(() => undefined)

    return next(e)
  })

  // Al invocar una skill se conoce el tamaño real de lo que lee el modelo.
  on('skill.prompt', async ($, e, next) => {
    const tokens = tokensDe(e.text)
    await update($, coste, c => ({
      ...c,
      medidos: { ...c.medidos, [e.skill]: tokens },
      filas: c.filas.map(f => (f.name === e.skill ? { ...f, cuerpo: tokens, isMedido: true } : f)),
    }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'coste-skill' }, async ($, e) => {
    const filtro = e.args.trim().toLowerCase()
    await update($, coste, c => ({ ...c, filtro }))
    await $.ui.open({ id: PANE, title: 'Coste por skill' })
    await cargar($)
    const c = await read($, coste)
    const mayores = [...c.filas]
      .sort((a, b) => (b.cuerpo ?? 0) - (a.cuerpo ?? 0))
      .slice(0, 5)
      .map(f => `${f.name} ~${corto(f.cuerpo ?? 0)} tokens`)

    return {
      text:
        `${c.totalSkills} skills · listado ~${corto(c.tokensListado)} tokens por petición` +
        (mayores.length ? ` · más pesadas: ${mayores.join(', ')}` : ''),
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : null
    const c = await read($, coste)
    const ordenes: { orden: Orden; label: string }[] = [
      { orden: 'cuerpo', label: 'Por coste' },
      { orden: 'listado', label: 'Por listado' },
      { orden: 'nombre', label: 'Por nombre' },
    ]

    const visibles = c.filas
      .filter(f => f.name.toLowerCase().includes(c.filtro))
      .sort((a, b) =>
        c.orden === 'nombre'
          ? a.name.localeCompare(b.name)
          : c.orden === 'listado'
            ? b.listado - a.listado
            : (b.cuerpo ?? -1) - (a.cuerpo ?? -1),
      )
    const mostradas = visibles.slice(0, MAX_FILAS)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor>Tener las skills listadas cuesta, en cada petición</Text>
          <Text size="title" weight="bold" tabular>
            ~{corto(c.tokensListado)} tokens · {usd(c.tokensListado, c.precioMillon)}
          </Text>
          <Text dimColor>
            {c.totalSkills} skills, {c.incluidas} en el listado
            {c.isCargando ? ' · leyendo…' : ''}
          </Text>
        </Box>

        <Box gap={1} flexWrap="wrap">
          {ordenes.map(o => (
            <Button
              key={`o-${o.orden}`}
              label={c.orden === o.orden ? `● ${o.label}` : o.label}
              onPress={() => update($, coste, x => ({ ...x, orden: o.orden }))}
            />
          ))}
          <Button key="recargar" label="Releer" onPress={() => cargar($)} />
        </Box>

        {Input && (
          <Input
            key="filtro"
            label="Filtrar"
            placeholder="nombre de la skill"
            value={c.filtro}
            onInput={v => void update($, coste, x => ({ ...x, filtro: v.trim().toLowerCase() }))}
            onSubmit={v => void update($, coste, x => ({ ...x, filtro: v.trim().toLowerCase() }))}
          />
        )}

        <Box flexDirection="column">
          <Text dimColor>Skill · tokens al invocarla · coste estimado</Text>
          {mostradas.length === 0 && <Text dimColor>No hay skills que coincidan.</Text>}
          {mostradas.map(f => (
            <Box flexDirection="column">
              <Text bold wrap="truncate-end">
                {f.name}
              </Text>
              <Text tabular dimColor={f.cuerpo === null}>
                {f.cuerpo === null
                  ? 'sin medir (se mide al invocarla)'
                  : `${f.isMedido ? '' : '~'}${corto(f.cuerpo)} tokens · ${usd(f.cuerpo, c.precioMillon)}`}
                <Text dimColor> · listado {f.listado}</Text>
              </Text>
            </Box>
          ))}
          {visibles.length > MAX_FILAS && (
            <Text dimColor>… y {visibles.length - MAX_FILAS} más (usa el filtro)</Text>
          )}
        </Box>

        <Box flexDirection="column">
          <Text dimColor>Precio de entrada por millón de tokens (editable, estimación)</Text>
          <Box gap={1} flexWrap="wrap">
            {[1, 3, 5, 15].map(p => (
              <Button
                key={`p${p}`}
                label={c.precioMillon === p ? `● $${p}` : `$${p}`}
                onPress={() => fijarPrecio($, p)}
              />
            ))}
          </Box>
          <Text dimColor>
            ~ = leído del fichero de la skill; sin ~ = medido al invocarla. Aproximado: ~4 caracteres por token.
          </Text>
        </Box>
      </Box>
    )
  })
}
