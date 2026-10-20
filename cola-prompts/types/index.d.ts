export type Pendiente = { id: string; texto: string }

export type Cola = {
  pendientes: Pendiente[]
  /** True mientras la cola va enviando una tarea tras otra. */
  isActiva: boolean
  /** Cuántas tareas ha enviado la cola desde que se pulsó Empezar. */
  enviadas: number
  mensaje: string
}

declare module 'claude-code' {
  interface PluginState {
    'cola-prompts': { cola: Cola }
  }
}
