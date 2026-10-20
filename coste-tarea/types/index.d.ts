export type Tarea = { titulo: string; usd: number }

export type Coste = {
  /** Coste total de la sesión, en USD. */
  sesionUsd: number
  /** Coste de la sesión cuando empezó la tarea actual. */
  inicioTareaUsd: number
  /** Título de la tarea actual (inicio del prompt). */
  titulo: string
  /** Presupuesto por tarea en USD; null sin límite. */
  presupuestoUsd: number | null
  /** Margen extra concedido con "Continuar" en esta tarea. */
  extraUsd: number
  /** True cuando la tarea llegó al presupuesto y las herramientas están bloqueadas. */
  isPausada: boolean
  /** Últimas tareas terminadas, la más reciente primero. */
  historial: Tarea[]
}

declare module 'claude-code' {
  interface PluginState {
    'coste-tarea': { coste: Coste }
  }
}
