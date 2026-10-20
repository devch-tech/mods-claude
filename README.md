# mods-claude

Diez mods para [Claude Code](https://claude.com/claude-code). Cada uno añade un panel al lado del chat (o vigila algo por ti) y se instala por separado.

## Instalar

En una terminal, dentro de una sesión de Claude Code (cambia `guardian` por el mod que quieras):

```
/plugin install guardian --marketplace devch-tech/mods-claude
```

Desde una shell:

```bash
claude plugin install guardian --marketplace devch-tech/mods-claude
```

La primera vez te preguntará `Add marketplace?`: responde `y` y elige el ámbito (`user` para tenerlo en todas tus sesiones). Un mod instalado queda activo en esa misma sesión.

En la app de escritorio, donde `/plugin` no funciona: pulsa **+** junto a la caja de texto, **Plugins**, **Add marketplace** con `devch-tech/mods-claude`, y luego **Add plugin**.

## Los mods

| Mod | Qué hace | Comando |
| --- | --- | --- |
| **coste-tarea** | Panel con lo gastado en la tarea actual frente a un presupuesto; al llegar, Claude no puede usar más herramientas hasta que pulses *Continuar*. | `/coste` |
| **modelo-tarea** | Clasifica cada prompt (planificar, programar, depurar…) y cambia al modelo que elijas para ese tipo de tarea; también cambia a mitad de tarea si Claude pasa a otro trabajo. | `/modelo` |
| **coste-skill** | Lista tus skills con lo que cuesta tenerlas listadas y una estimación de lo que cuesta invocar cada una. | `/coste-skill` |
| **puntos-restauracion** | Guarda una copia de cada archivo justo antes de que Claude lo edite. Lista de puntos con hora y prompt, y botón para volver a uno. | `/puntos` |
| **guardian** | Bloquea que Claude escriba claves y tokens en tus archivos o ejecute comandos destructivos (`rm -rf /`, `git push --force`…). Un clic en el panel lo permite. | `/guardian` |
| **medidor-contexto** | Muestra cuánto contexto llevas y tus límites de uso, y avisa una vez al cruzar el 70 % y el 85 %. | `/contexto` |
| **cronometro-turnos** | Cronometra cada tarea, cuenta las herramientas que usa y avisa si pasa del tiempo que elijas. | `/tiempos` |
| **pizarra** | Notas fijas por proyecto que Claude lee en cada petición. | `/pizarra` |
| **radar-archivos** | Qué archivos ha leído y editado Claude, ordenados por actividad. | `/archivos` |
| **cola-prompts** | Encadena varias tareas: Claude hace una, y al terminar envía la siguiente. Si interrumpes, se pausa. | `/cola` |

## Cosas que conviene saber

- **Los costes son estimaciones.** `coste-skill` cuenta unos 4 caracteres por token y usa un precio por millón de tokens que puedes cambiar en el panel.
- **`puntos-restauracion` solo ve las ediciones que hace Claude con Edit, Write y notebooks.** Los cambios hechos desde la terminal no tienen copia. Solo guarda archivos de texto de hasta 4 MiB, y las copias (en `~/.claude/puntos-restauracion/`) no se borran solas.
- **`guardian` busca patrones conocidos.** Ayuda, pero no sustituye a revisar lo que Claude hace.
- **`modelo-tarea` clasifica cada prompt con una llamada pequeña a un modelo rápido**, y cada cambio de modelo pierde la caché de la conversación.
- Los mods usan una API de Claude Code aún en acceso temprano; pueden dejar de funcionar si cambia.

## Probarlos

Cada mod trae su test. Con Claude Code instalado:

```bash
claude plugin validate ./guardian
claude plugin test ./guardian
```

## Licencia

MIT.
