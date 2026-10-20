export type CopiaArchivo = {
  /** Ruta absoluta del archivo tocado. */
  ruta: string
  /** False si el archivo no existía: restaurar es borrarlo. */
  isExistente: boolean
  /** Dónde está guardada la copia; null si no existía o no se pudo copiar. */
  copia: string | null
  /** Por qué no hay copia de un archivo que sí existía. */
  aviso?: string
}

export type Punto = {
  id: string
  /** Hora del primer cambio, en ms. */
  hora: number
  prompt: string
  archivos: CopiaArchivo[]
  /** True para el punto que se crea solo antes de restaurar. */
  isAutomatico?: boolean
}

export type Puntos = {
  /** Del más antiguo al más reciente. */
  lista: Punto[]
  /** Id del punto cuyo botón pide confirmación. */
  confirmando: string | null
  /** Último resultado de una restauración. */
  mensaje: string
}

declare module 'claude-code' {
  interface PluginState {
    'puntos-restauracion': { puntos: Puntos }
  }
}
