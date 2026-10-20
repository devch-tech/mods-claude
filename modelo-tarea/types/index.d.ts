export type TipoTarea =
  | 'planificar'
  | 'programar'
  | 'depurar'
  | 'explorar'
  | 'escribir'
  | 'rapida'

/** auto: elige por tarea; manual: siempre `modeloManual`; off: el de la sesión. */
export type Modo = 'auto' | 'manual' | 'off'

export type Cambio = { de: string; a: string; motivo: string }

export type Selector = {
  modo: Modo
  modeloManual: string
  /** Modelo por tipo de tarea; '' deja el de la sesión. */
  mapa: Record<TipoTarea, string>
  /** True: también cambia a mitad de tarea según las herramientas que use Claude. */
  isAMitad: boolean
  tarea: TipoTarea | null
  /** Modelo que pidió la última petición al API. */
  modeloActivo: string
  cambios: Cambio[]
}

declare module 'claude-code' {
  interface PluginState {
    'modelo-tarea': { selector: Selector }
  }
}
