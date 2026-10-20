export type FilaSkill = {
  name: string
  /** De dónde viene: userSettings, projectSettings, plugin, built-in, mcp... */
  origen: string
  pluginName?: string
  /** Tokens que ocupa su entrada en el listado que ve el modelo en cada petición. */
  listado: number
  /** Tokens del cuerpo al invocarla; null si aún no se ha podido medir. */
  cuerpo: number | null
  /** True si el cuerpo es el texto real de una invocación en esta sesión. */
  isMedido: boolean
}

export type Orden = 'cuerpo' | 'listado' | 'nombre'

export type CosteSkill = {
  filas: FilaSkill[]
  /** Cuerpos medidos al invocar cada skill en esta sesión (tokens). */
  medidos: Record<string, number>
  totalSkills: number
  incluidas: number
  tokensListado: number
  /** USD por millón de tokens de entrada, editable. */
  precioMillon: number
  filtro: string
  orden: Orden
  /** True mientras se leen los ficheros. */
  isCargando: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'coste-skill': { coste: CosteSkill }
  }
}
