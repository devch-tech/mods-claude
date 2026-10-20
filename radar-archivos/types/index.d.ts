export type Actividad = {
  ruta: string
  lecturas: number
  ediciones: number
  /** Marca de tiempo de la última vez que se tocó. */
  ultimo: number
}

export type Radar = {
  archivos: Actividad[]
  /** Carpeta del proyecto, para mostrar rutas cortas. */
  raiz: string
  soloEditados: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'radar-archivos': { radar: Radar }
  }
}
