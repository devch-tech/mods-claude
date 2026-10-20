import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bloqueo, Guardian } from '../types'

const PANE = 'guardian'

const guardian = atom({ plugin: 'guardian', key: 'guardian' } as const, {
  isSecretos: true,
  isComandos: true,
  bloqueos: [],
  total: 0,
} as Guardian)

const SECRETOS: { regla: string; patron: RegExp }[] = [
  { regla: 'Clave de AWS', patron: /\bAKIA[0-9A-Z]{16}\b/ },
  { regla: 'Token de GitHub', patron: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { regla: 'Clave de Anthropic', patron: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { regla: 'Clave tipo sk-', patron: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { regla: 'Clave de Google', patron: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { regla: 'Token de Slack', patron: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { regla: 'Clave privada', patron: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  {
    regla: 'Contraseña o token en claro',
    patron: /\b(password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  },
]

const COMANDOS: { regla: string; patron: RegExp }[] = [
  { regla: 'Borrado recursivo de raíz, home o todo', patron: /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*[fF]|-[a-zA-Z]*[fF][a-zA-Z]*[rR])[a-zA-Z]*\s+(\/|~|\$HOME|\*|\.)(\s|$)/ },
  { regla: 'git push --force', patron: /\bgit\s+push\b[^\n;&|]*\s(--force\b(?!-with-lease)|-f\b)/ },
  { regla: 'git reset --hard', patron: /\bgit\s+reset\s+--hard\b/ },
  { regla: 'git clean -f', patron: /\bgit\s+clean\s+-[a-zA-Z]*f/ },
  { regla: 'Borrar tablas o bases de datos', patron: /\bdrop\s+(table|database|schema)\b/i },
  { regla: 'Formatear o escribir sobre un disco', patron: /\bmkfs\b|\bdd\s+[^\n]*of=\/dev\/|\bformat\s+[a-zA-Z]:/i },
  { regla: 'Descargar y ejecutar un script', patron: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|pwsh|powershell)\b/ },
  { regla: 'Borrado recursivo en Windows', patron: /\b(Remove-Item|rd|rmdir|del)\b[^\n]*(-Recurse|\/s)[^\n]*([A-Za-z]:\\?(\s|$|\*)|\$env:USERPROFILE)/i },
  { regla: 'Fork bomb', patron: /:\(\)\s*\{\s*:\|:&\s*\};:/ },
]

const IGNORADOS = /\.(example|sample|template|md)$/i

const corto = (t: string, n = 70) => (t.length > n ? `${t.slice(0, n)}…` : t)

// Si el mismo intento ya estaba permitido, lo deja pasar una vez; si no, lo registra.
async function registrar(
  $: EngineInterface,
  tipo: Bloqueo['tipo'],
  regla: string,
  detalle: string,
  clave: string,
): Promise<boolean> {
  const g = await read($, guardian)
  const permitido = g.bloqueos.find(b => b.clave === clave && b.isPermitido)
  if (permitido) {
    await update($, guardian, c => ({
      ...c,
      bloqueos: c.bloqueos.map(b => (b.id === permitido.id ? { ...b, isPermitido: false } : b)),
    }))
    return true
  }
  const ahora = await $.clock.now()
  const nuevo: Bloqueo = { id: `b${ahora}-${g.total}`, hora: ahora, tipo, regla, detalle: corto(detalle), clave, isPermitido: false }
  await update($, guardian, c => ({
    ...c,
    total: c.total + 1,
    bloqueos: [nuevo, ...c.bloqueos.filter(b => b.clave !== clave)].slice(0, 15),
  }))
  $.ui.toast(`Guardián bloqueó: ${regla}`)
  return false
}

async function permitir($: EngineInterface, id: string) {
  await update($, guardian, c => ({
    ...c,
    bloqueos: c.bloqueos.map(b => (b.id === id ? { ...b, isPermitido: true } : b)),
  }))
}

async function alternar($: EngineInterface, cual: 'isSecretos' | 'isComandos') {
  await update($, guardian, c => ({ ...c, [cual]: !c[cual] }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'guardian', description: 'Panel del Guardián: secretos y comandos bloqueados' })
    void $.ui.open({ id: PANE, title: 'Guardián' })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const g = await read($, guardian)

    // Lo que Claude va a escribir en un archivo.
    const texto =
      e.tool === 'Write' ? e.content : e.tool === 'Edit' ? e.new_string : undefined
    const archivo = e.tool === 'Write' || e.tool === 'Edit' ? e.file_path : ''
    if (g.isSecretos && texto !== undefined && !IGNORADOS.test(archivo)) {
      const hallazgo = SECRETOS.find(s => s.patron.test(texto))
      if (hallazgo) {
        const dejar = await registrar($, 'secreto', hallazgo.regla, archivo, `secreto:${archivo}:${hallazgo.regla}`)
        if (!dejar) {
          return {
            deny:
              `Guardián: el texto que ibas a escribir en ${archivo} contiene un secreto (${hallazgo.regla}). ` +
              'No lo escribas en el archivo: léelo de una variable de entorno o de un archivo ignorado por git. ' +
              'Si es intencionado, dile al usuario que pulse "Permitir" en el panel del Guardián y reintenta.',
          }
        }
      }
    }

    if (g.isComandos && e.tool === 'Bash') {
      const hallazgo = COMANDOS.find(c => c.patron.test(e.command))
      if (hallazgo) {
        const dejar = await registrar($, 'comando', hallazgo.regla, e.command, `comando:${e.command}`)
        if (!dejar) {
          return {
            deny:
              `Guardián: comando bloqueado (${hallazgo.regla}). No lo ejecutes sin permiso: ` +
              'explícale al usuario qué hace y por qué lo necesitas, y que pulse "Permitir" en el panel si está de acuerdo; luego reintenta.',
          }
        }
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'guardian' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Guardián' })
    const g = await read($, guardian)

    return { text: `Guardián: ${g.total} bloqueos · secretos ${g.isSecretos ? 'on' : 'off'} · comandos ${g.isComandos ? 'on' : 'off'}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const g = await read($, guardian)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text size="title" weight="bold">
            {g.total} {g.total === 1 ? 'bloqueo' : 'bloqueos'}
          </Text>
          <Text dimColor>Vigila lo que Claude escribe y ejecuta, antes de que ocurra.</Text>
        </Box>

        <Box gap={1} flexWrap="wrap">
          <Button
            key="secretos"
            label={g.isSecretos ? '☑ Vigilar secretos' : '☐ Vigilar secretos'}
            onPress={() => alternar($, 'isSecretos')}
          />
          <Button
            key="comandos"
            label={g.isComandos ? '☑ Vigilar comandos' : '☐ Vigilar comandos'}
            onPress={() => alternar($, 'isComandos')}
          />
        </Box>

        {g.bloqueos.length === 0 && <Text dimColor>Nada bloqueado por ahora.</Text>}

        {g.bloqueos.map(b => (
          <Box flexDirection="column" key={b.id}>
            <Text bold color={b.tipo === 'secreto' ? 'error' : 'warning'}>
              {b.tipo === 'secreto' ? '🔑 ' : '⚠ '}
              {b.regla}
            </Text>
            <Text dimColor wrap="truncate-end">
              {b.detalle}
            </Text>
            {b.isPermitido ? (
              <Text color="success">Permitido: pide a Claude que lo reintente.</Text>
            ) : (
              <Button key={`ok-${b.id}`} label="Permitir esta vez" onPress={() => permitir($, b.id)} />
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
