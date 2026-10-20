export type Limite = { kind: string; percentUsed: number; resetsAt?: string }

export type Medida = {
  /** Tokens del contexto en la última respuesta; null antes de la primera. */
  tokens: number | null
  ventana: number
  porcentaje: number | null
  limites: Limite[]
  /** Umbrales de aviso ya mostrados (70 y 85). */
  avisados: number[]
  /** Porcentaje a partir del cual avisa primero. */
  umbral: number
}

declare module 'claude-code' {
  interface PluginState {
    'medidor-contexto': { medida: Medida }
  }
}
