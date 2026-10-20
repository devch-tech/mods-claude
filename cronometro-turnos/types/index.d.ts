export type Tarea = {
  id: string
  prompt: string
  inicio: number
  /** Duración en ms; null mientras sigue en curso. */
  duracion: number | null
  herramientas: number
  /** Herramienta que más veces se usó, p. ej. "Read ×4". */
  principal: string
  isInterrumpida: boolean
}

export type Cronometro = {
  /** Más reciente primero. */
  tareas: Tarea[]
  /** Segundos a partir de los cuales avisa; 0 desactiva. */
  avisoSegundos: number
  /** Marca de tiempo del último refresco, para que el panel avance en vivo. */
  tic: number
}

declare module 'claude-code' {
  interface PluginState {
    'cronometro-turnos': { cronometro: Cronometro }
  }
}
