import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CopiaArchivo, Punto, Puntos } from '../types'

const PANE = 'puntos-restauracion'
const MAX_PUNTOS = 100

const puntos = atom({ plugin: 'puntos-restauracion', key: 'puntos' } as const, {
  lista: [],
  confirmando: null,
  mensaje: '',
} as Puntos)

// Lo que cambia con cada prompt; las copias se encolan para no pisarse.
const ctx: { prompt: string; punto: string | null; sesion: string } = {
  prompt: '',
  punto: null,
  sesion: 'sesion',
}
let cola: Promise<unknown> = Promise.resolve()

const nombreDe = (ruta: string) => ruta.slice(ruta.lastIndexOf('/') + 1)
const norm = (ruta: string) => ruta.replace(/\\/g, '/')
const hora = (ms: number) =>
  new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const dia = (ms: number) => new Date(ms).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })

async function carpetaBase($: EngineInterface) {
  const home = norm((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '')
  return `${home}/.claude/puntos-restauracion/${ctx.sesion}`
}

async function persistir($: EngineInterface) {
  const { lista } = await read($, puntos)
  await $.store.set(`lista:${ctx.sesion}`, lista.slice(-MAX_PUNTOS))
}

// Guarda la copia de un archivo en la carpeta del punto; no lanza.
async function copiar($: EngineInterface, ruta: string, punto: string): Promise<CopiaArchivo> {
  try {
    if (!(await $.fs.exists(ruta))) return { ruta, isExistente: false, copia: null }
    const texto = await $.fs.read(ruta)
    const n = (await read($, puntos)).lista.find(p => p.id === punto)?.archivos.length ?? 0
    const destino = `${await carpetaBase($)}/${punto}/${n}-${nombreDe(ruta)}`
    await $.fs.write(destino, texto)
    return { ruta, isExistente: true, copia: destino }
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    return { ruta, isExistente: true, copia: null, aviso: `sin copia: ${motivo}`.slice(0, 120) }
  }
}

// Antes de tocar un archivo: lo copia al punto del prompt actual (una vez por prompt).
async function guardarAntes($: EngineInterface, ruta: string) {
  const ahora = await $.clock.now()
  let id = ctx.punto
  if (id === null) {
    id = `p${ahora}`
    ctx.punto = id
    const nuevo: Punto = { id, hora: ahora, prompt: ctx.prompt || '(sin prompt)', archivos: [] }
    await update($, puntos, c => ({ ...c, lista: [...c.lista, nuevo].slice(-MAX_PUNTOS) }))
  }
  const actual = (await read($, puntos)).lista.find(p => p.id === id)
  if (actual?.archivos.some(a => a.ruta === ruta)) return

  const archivo = await copiar($, ruta, id)
  await update($, puntos, c => ({
    ...c,
    lista: c.lista.map(p => (p.id === id ? { ...p, archivos: [...p.archivos, archivo] } : p)),
  }))
  await persistir($)
}

async function borrar($: EngineInterface, ruta: string) {
  const isWindows = /^[A-Za-z]:/.test(ruta)
  const argv = isWindows
    ? ['cmd', '/c', 'del', '/f', '/q', ruta.replace(/\//g, '\\')]
    : ['rm', '-f', ruta]
  const r = await $.process.run(argv)
  if (r.exitCode !== 0) throw new Error(`no se pudo borrar ${nombreDe(ruta)}`)
}

// Vuelve al estado de antes del punto `id`, deshaciendo también los puntos posteriores.
async function restaurar($: EngineInterface, id: string) {
  const { lista } = await read($, puntos)
  const desde = lista.findIndex(p => p.id === id)
  if (desde < 0) return

  // Por archivo vale la copia más antigua desde ese punto: es cómo estaba entonces.
  const plan = new Map<string, CopiaArchivo>()
  for (const p of lista.slice(desde)) {
    for (const a of p.archivos) if (!plan.has(a.ruta)) plan.set(a.ruta, a)
  }

  // Red de seguridad: un punto con el estado actual, para poder deshacer la restauración.
  const ahora = await $.clock.now()
  const autoId = `r${ahora}`
  const auto: Punto = {
    id: autoId,
    hora: ahora,
    prompt: `Antes de volver a: ${lista[desde]?.prompt.slice(0, 60) ?? ''}`,
    archivos: [],
    isAutomatico: true,
  }
  await update($, puntos, c => ({ ...c, lista: [...c.lista, auto].slice(-MAX_PUNTOS) }))
  const respaldos: CopiaArchivo[] = []
  for (const ruta of plan.keys()) {
    const n = respaldos.length
    try {
      if (!(await $.fs.exists(ruta))) {
        respaldos.push({ ruta, isExistente: false, copia: null })
        continue
      }
      const destino = `${await carpetaBase($)}/${autoId}/${n}-${nombreDe(ruta)}`
      await $.fs.write(destino, await $.fs.read(ruta))
      respaldos.push({ ruta, isExistente: true, copia: destino })
    } catch {
      respaldos.push({ ruta, isExistente: true, copia: null, aviso: 'sin copia' })
    }
  }
  await update($, puntos, c => ({
    ...c,
    lista: c.lista.map(p => (p.id === autoId ? { ...p, archivos: respaldos } : p)),
  }))

  let hechos = 0
  const fallos: string[] = []
  for (const [ruta, a] of plan) {
    try {
      if (a.copia !== null) {
        await $.fs.write(ruta, await $.fs.read(a.copia))
        hechos += 1
      } else if (!a.isExistente) {
        await borrar($, ruta)
        hechos += 1
      } else {
        fallos.push(`${nombreDe(ruta)} (no hay copia)`)
      }
    } catch (error) {
      fallos.push(`${nombreDe(ruta)} (${error instanceof Error ? error.message : 'error'})`.slice(0, 80))
    }
  }

  await update($, puntos, c => ({
    ...c,
    confirmando: null,
    mensaje:
      `Restaurados ${hechos} de ${plan.size} archivos.` +
      (fallos.length ? ` No se pudo: ${fallos.join(', ')}.` : '') +
      ' Se guardó un punto para deshacerlo.',
  }))
  await persistir($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    ctx.sesion = await $.session.id()
    const guardada = await $.store.get(`lista:${ctx.sesion}`)
    if (Array.isArray(guardada)) {
      await update($, puntos, c => ({ ...c, lista: guardada as Punto[] }))
    }
    await $.command.register({
      name: 'puntos',
      description: 'Puntos de restauración: copias de tus archivos antes de cada cambio',
    })
    void $.ui.open({ id: PANE, title: 'Puntos de restauración' })

    return next(e)
  })

  // Cada prompt tuyo abre un punto nuevo (se crea al primer archivo que se toque).
  on('prompt.submit', ($, e, next) => {
    if (e.command === undefined && e.isMeta === undefined && e.text.trim()) {
      ctx.prompt = e.text.replace(/\s+/g, ' ').trim().slice(0, 300)
      ctx.punto = null
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // La copia se hace ANTES de que la herramienta toque el archivo.
  on('tool.call', async ($, e, next) => {
    const ruta =
      e.tool === 'Edit' || e.tool === 'Write'
        ? e.file_path
        : e.tool === 'NotebookEdit'
          ? e.notebook_path
          : undefined

    if (ruta !== undefined && !norm(ruta).includes('/.claude/puntos-restauracion/')) {
      const destino = norm(ruta)
      cola = cola.then(() => guardarAntes($, destino)).catch(() => undefined)
      await cola
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'puntos' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Puntos de restauración' })
    const { lista } = await read($, puntos)
    const ultimo = lista[lista.length - 1]

    return {
      text: ultimo
        ? `${lista.length} puntos · último ${hora(ultimo.hora)}: ${ultimo.prompt.slice(0, 60)}`
        : 'Aún no hay puntos: se crean cuando Claude toque un archivo.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = await read($, puntos)
    const recientes = [...c.lista].reverse()

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text size="title" weight="bold">
            {c.lista.length} {c.lista.length === 1 ? 'punto' : 'puntos'}
          </Text>
          <Text dimColor>
            Copia de tus archivos justo antes de que Claude los cambie (Edit, Write y notebooks; no los cambios
            hechos desde Bash).
          </Text>
          {c.mensaje !== '' && <Text color="success">{c.mensaje}</Text>}
        </Box>

        {recientes.length === 0 && <Text dimColor>Aún no hay puntos.</Text>}

        {recientes.map(p => (
          <Box flexDirection="column" key={p.id}>
            <Text bold tabular>
              {hora(p.hora)} <Text dimColor>{dia(p.hora)}</Text>
              {p.isAutomatico ? <Text dimColor> · automático</Text> : null}
            </Text>
            <Text wrap="truncate-end">{p.prompt}</Text>
            {p.archivos.slice(0, 4).map(a => (
              <Text dimColor wrap="truncate-start">
                {a.isExistente ? '' : '+ nuevo · '}
                {a.aviso ? '⚠ ' : ''}
                {a.ruta}
              </Text>
            ))}
            {p.archivos.length > 4 && <Text dimColor>… y {p.archivos.length - 4} más</Text>}
            {c.confirmando === p.id ? (
              <Box gap={1} flexWrap="wrap">
                <Text color="warning">¿Volver aquí? Se deshace también lo posterior.</Text>
                <Button key={`si-${p.id}`} label="Sí, restaurar" onPress={() => restaurar($, p.id)} />
                <Button
                  key={`no-${p.id}`}
                  label="Cancelar"
                  onPress={() => update($, puntos, x => ({ ...x, confirmando: null }))}
                />
              </Box>
            ) : (
              <Button
                key={`volver-${p.id}`}
                label="Volver a este punto"
                onPress={() => update($, puntos, x => ({ ...x, confirmando: p.id, mensaje: '' }))}
              />
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
