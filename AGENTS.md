# Reglas para agentes en sala-kit

sala-kit es el motor reutilizable de una **sala**: la sesión que coordina varios repositorios (los **miembros**) con una persona que decide. El kit no sabe nada de ningún proyecto. Cada sala (upen-ceo hoy, h2o-sala mañana) es una **instancia** con su `sala.json`. El diseño completo está en [`docs/DISENO.md`](docs/DISENO.md).

- Node >= 20, **sin dependencias**. Sin bash: todo lo que hoy hacen los scripts `.sh` de la sala se escribe en Node.
- Rama base: `main`. Remoto: `victorvelazquez/sala-kit` en GitHub, público, con la misma configuración que repo-panel (squash y rebase, sin merge commit; la rama se borra al fusionar).
- **Idioma.** El código, los identificadores y las claves de JSON van en inglés. Los documentos (`README.md`, `docs/`), los comandos que escribe la persona y los textos que ella lee van en español.
- **Finales de línea LF** en todos los archivos (`.gitattributes`).

## Idioma de las respuestas

**Respondé siempre en español rioplatense**, desde el primer mensaje de cada sesión. Vale aunque el mensaje llegue en inglés: los comandos como `/flow-next`, `/flow-ship` o `/flow-base` mandan su prompt en inglés, pero los escribe la persona, y ella lee en español. Solo cambiá de idioma si la persona te lo pide con palabras propias.

## Registro de trabajo

El trabajo vive en `docs/ROADMAP.md`, con el formato de Orquestación 1.0.

- **Toda tarea es una fila de la tabla.** No hay otro lugar: ni listas sueltas, ni tableros, ni carpetas de planificación.
- **Campos:** `ID` (prefijo `SK`), `Entrega`, `Resultado visible`, `Depende de` (IDs de la tabla, o `—`; nunca se infieren), `Estado`, `Notas` y `Ficha`. Si una tarea necesita más detalle, su ficha va en `docs/tareas/<ID>.md`.
- **Estado:** una sola palabra entre `Pendiente`, `En curso`, `Completada` y `Bloqueada`. `Lista` y `En revisión` se calculan desde Git y el alojamiento: no se escriben. El detalle (PR, motivo de un bloqueo) va en `Notas`.
- **`siguiente`** toma la primera fila `Pendiente` cuyas dependencias que son filas de la tabla estén `Completada`. Las dependencias de otro proyecto (por ejemplo `upen-ceo`) o de una decisión de la persona son informativas: se muestran y no bloquean.
- **Cabecera de tres líneas** al principio del roadmap: dónde está el proyecto, qué sigue y qué lo bloquea.
- **Al terminar una unidad**, en el mismo diff: su fila pasa a `Completada`, la cabecera se actualiza y su ficha se cierra.

## Puerta antes de una unidad nueva

Antes del primer archivo de una unidad nueva, verificá con git:
1. estás en `main`;
2. el árbol está limpio y sin stash;
3. `main` es igual al remoto, cuando hay remoto.

Si falla alguna, no escribas: decile a la persona qué falta y esperá. No aplica a seguir una unidad en curso ni a corregir un PR abierto.

## Entrega

- **La persona entrega**, con `/flow-commit`, `/flow-pr` y `/flow-ship`. Vos dejás los cambios en el árbol de trabajo.
- **Prohibido para el agente:** `git commit`, `git add`, `git mv`, crear o cambiar de rama, push, abrir o fusionar un PR. Si algo de esto se hizo por error, no lo reviertas: avisale a la persona.
- **Una tarea = un PR.** El ID de la tarea va al final del título, entre paréntesis.
- **Tamaño.** Estimá antes de implementar. Si el código pasa de **450 líneas**, partí la unidad. Tope de **600 líneas** por PR; solo se supera por pruebas y con nota explícita.
- **Al terminar**, decile a la persona qué quedó listo, qué sigue (normalmente `/flow-ship`) y el ID de la tarea.

## Escribir fuera de este repositorio

El kit trabaja sobre salas y miembros que son repositorios de la persona.
- **Escribir en una sala o en un miembro** (por ejemplo `upen-ceo` o un repo de producto) requiere que la persona lo apruebe por escrito, unidad por unidad. Las pruebas usan repositorios temporales, nunca los reales.
- **Nunca** cambies la configuración de Gentle Shell, de pi, de Orca o de Claude sin la persona.
- **Nunca** leas, copies ni imprimas claves o tokens (por ejemplo los de `mcp.json`).

## Pruebas: rápido sin perder lo crítico

**Zona crítica.** Es una lista cerrada; para sumarle algo hace falta el OK de la persona:
- mandar órdenes a una sesión de un miembro (`sala enviar` y los comandos que lo usan);
- fusionar un PR (`sala fusionar`) y el motor de entrega (commit y PR);
- abrir, cerrar y esperar sesiones y procesos (los adaptadores de transporte);
- escribir en salas y miembros: bloques administrados de `AGENTS.md`, `sala actualizar`, `/sala-adoptar` y la orden de ponerse en condiciones;
- borrar o descartar datos;
- que ningún secreto salga en la salida JSON ni en un registro.

En la zona crítica:
- las pruebas se escriben primero y se las ve fallar;
- una prueba reproduce el abuso;
- se corre la suite completa en local;
- hay verificación independiente;
- si es de riesgo alto, va en un PR propio.

**Lógica fuera de la zona crítica** (leer roadmaps, calcular el plan, revisar requisitos, dar formato): pocas pruebas de comportamiento, escritas primero y vistas fallar, sobre lo que la función hace y no sobre cómo está escrita.

**Plantillas y textos** (prompts de comandos, bloques de `AGENTS.md`): sin pruebas que comparen su texto con expresiones regulares. Las aprueba la persona leyéndolas.

**Ciclo.** Mientras se trabaja: `node --test test/<archivo>.test.js`. Suite completa: `node --test test/*.test.js`.

## Estado para el panel

Después de cada acción que escriba archivos, o cuando necesites una decisión de la persona:
1. escribí `.panel/state.json` con la hora real (`node -p "new Date().toISOString()"`):
   `{"state": "...", "next": "una línea: qué debe hacer la persona ahora", "detail": "opcional", "at": "..."}`.
   `state` es `working`, `needs-input`, `ready-to-commit`, `ready-to-pr` o `blocked`;
2. terminá la respuesta con una línea `Siguiente: <el mismo paso>`;
3. `.panel/` nunca se commitea: está en `.git/info/exclude`.
