export type Pizarra = {
  /** Texto fijado que Claude lee en cada petición. */
  nota: string
  /** False: la nota se conserva pero Claude no la lee. */
  isActiva: boolean
  /** Carpeta del proyecto a la que pertenece la nota. */
  proyecto: string
}

declare module 'claude-code' {
  interface PluginState {
    pizarra: { pizarra: Pizarra }
  }
}
