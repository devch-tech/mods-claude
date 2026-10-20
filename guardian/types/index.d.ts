export type Bloqueo = {
  id: string
  hora: number
  tipo: 'secreto' | 'comando'
  /** Qué se detectó (nombre de la regla). */
  regla: string
  /** Archivo o comando afectado, recortado. */
  detalle: string
  /** Clave con la que se reconoce el mismo intento. */
  clave: string
  /** True si pulsaste "Permitir": el próximo intento igual pasa. */
  isPermitido: boolean
}

export type Guardian = {
  isSecretos: boolean
  isComandos: boolean
  bloqueos: Bloqueo[]
  total: number
}

declare module 'claude-code' {
  interface PluginState {
    guardian: { guardian: Guardian }
  }
}
