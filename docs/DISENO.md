# Diseño de sala-kit

Decisiones acordadas con la persona el 2026-11-20, después de pilotear la sala de upen en la terminal con Gentle Shell y Orca (ciclo completo probado con upen-brand M2c, PR #11). Cada decisión lleva un número para poder citarla desde el roadmap (`D3`, `D12`…).

## Por qué existe

La sala de upen funciona, pero hace con el modelo mucho trabajo mecánico. Medido el 2026-11-20:
- **al arrancar** lee unos 70 KB (AGENTS, ESTADO, TABLERO), unos 20.000 tokens, de nuevo tras cada compactación;
- **el plan del día** lee los roadmaps de 7 repos, unos 114 KB y 30.000 tokens;
- **`estado-vivo.sh`** tarda 97 s y marca NO LISTO a todos los repos sin decir por qué. Dentro del script falla el `git fetch` y anota «no se pudo consultar el remoto», mientras `puerta-de-ciclo.sh`, corrida sola, da LISTO para los mismos repos. La causa no está confirmada;
- **un `/flow-ship` mandado por la sala** cuesta varios turnos solo para esperar mirando la pantalla.

Además, la sala está atada a upen: los repos en `proyectos.conf`, supuestos de upen en los scripts y las reglas en el `AGENTS.md` de upen-ceo. La persona quiere replicarla (por ejemplo, `h2o-sala`).

**Principio:** lo mecánico lo hace un script que devuelve JSON; el modelo coordina, resume y pregunta.

## Nombres

- **D1.** **Sala** es la sesión que coordina, y la carpeta que la contiene es la **instancia**. Los repos que coordina son sus **miembros**. Un repo puede no ser miembro de ninguna sala.
- **D2.** El código, los identificadores y las claves de JSON van en inglés. Los comandos que escribe la persona y los textos que lee van en español.

## Kit, instancia y estado

- **D3.** El **kit** (este repo) es el motor: la CLI, los comandos, el catálogo de requisitos, las plantillas y los adaptadores. No contiene nada de ningún proyecto.
- **D4.** La **instancia** es la carpeta de cada sala, con un `sala.json` versionado. Ejemplo:

```json
{
  "schema": 1,
  "kit": "0.1.0",
  "name": "upen",
  "members": [
    { "id": "core", "prefix": "CORE", "path": "C:/Users/victor/Developer/upen/upen-core", "base": "develop", "remote": "origin" },
    { "id": "brand", "prefix": "BRAND", "path": "C:/Users/victor/Developer/upen/upen-brand", "base": "develop", "remote": "origin" }
  ],
  "options": {
    "language": "en",
    "jira": false,
    "transport": "orca",
    "roomModel": null
  }
}
```

  El formato exacto de los campos lo fija SK1a; este ejemplo es la intención. Las rutas son de la máquina, igual que hoy en `proyectos.conf`.
- **D5.** El **estado vivo** de la sala va en `.sala/estado.json` dentro de la instancia, sin versionar: las sesiones abiertas por miembro, las órdenes en vuelo y las aprobaciones pendientes. Si la sala se compacta o se reinicia, retoma leyendo ese archivo y no de memoria.
- **D6.** `sala.json` **también se edita a mano**. `/sala-adoptar` es la forma cómoda, no la única. Después de editarlo, `sala revisar` dice si quedó bien.

## JSON o Markdown

- **D7.** **JSON** para lo que escribe y lee una máquina: la salida de la CLI, `sala.json` y el estado vivo. **Markdown** para lo que escribe o lee la persona: decisiones, estrategia, tablero.
- **D8.** **Los roadmaps de los miembros siguen en Markdown** (`docs/ROADMAP.md`, formato de Orquestación 1.0). Los leen la persona, el panel y los comandos; la CLI los convierte. Pasarlos a JSON rompería todo eso a cambio de nada.

## La CLI `sala`

- **D9.** **En Node, sin dependencias, sin bash.** Los dos problemas del piloto vinieron de Git Bash: la `/` de `/flow-ship` convertida en ruta y el `fetch` que falla dentro de `estado-vivo.sh`.
- **D10.** **Toda salida es JSON compacto** por defecto, con `--texto` para leerla una persona. Ese JSON es un **contrato**: el panel lo va a consumir (D30), así que cambia con versión.
- **D11.** **Subcomandos:**

| Subcomando | Qué hace |
|---|---|
| `sala estado` | La foto real de cada miembro: rama, árbol, stash, igual al remoto, PR abiertos y su CI, la puerta **con su motivo**. En paralelo. Reemplaza `estado-vivo.sh` |
| `sala plan` | Por miembro: la tarea en curso, la siguiente lista y lo bloqueado y por qué. **Resuelve las dependencias con prefijo entre miembros** (`CORE-E09` se busca en el roadmap de core). Unos 2 KB en vez de 114 KB |
| `sala revisar [miembro]` | Qué requisitos cumple cada miembro y cuáles no (D24) |
| `sala abrir <miembro>` | Reusa la sesión viva del miembro o abre una nueva y espera a que esté lista |
| `sala enviar <miembro> <comando> [args]` | Manda **cualquier** comando con las mismas guardas (D13) |
| `sala esperar <miembro>` | Termina cuando la sesión terminó su turno (D15) |
| `sala veredicto <miembro> <comando>` | Las comprobaciones fijas de cada comando, en JSON (D16) |
| `sala fusionar <miembro> <n>` | La cadena de fusión (D18) |
| `sala init` | Crea una sala en una carpeta: `sala.json`, el `AGENTS.md` con sus bloques y la carpeta `.sala/` ignorada |
| `sala actualizar` | Lleva la instancia a la versión instalada del kit (D27) |

- **D12.** Los miembros se nombran por su `id` de `sala.json`, nunca por ruta.

## Mandar órdenes a los miembros

- **D13.** `sala enviar` manda por la bandeja del feed (`send_prompt`, D46). Las guardas son dos capas:
  - **las de Gentle Shell**, que la bandeja ya aplica: se niega con una pregunta abierta; guarda el mensaje mientras la sesión compacta; rechaza los comandos que solo corren en la terminal (`/gentle:*`, `/new`, `/quit`, las líneas `!`). Las plantillas, como `/flow-ship` y `/miembro-*`, pasan. Un mensaje de la sala nunca cuenta como consentimiento de la persona;
  - **las del kit**: la sala en pausa (D38), el miembro existe en `sala.json` y tiene una sesión viva que es suya, y la orden queda en el registro.

  Al no tipear en una terminal, desaparece el problema de Git Bash con la `/`.
- **D14.** **Capa de transporte en dos puertos.** El núcleo nunca llama a una herramienta directamente:
  - **el lanzador** abre, muestra y cierra la terminal de una sesión;
  - **el feed** mira, espera, manda órdenes y contesta preguntas simples (D46).

| Adaptador | Puerto | Cuándo |
|---|---|---|
| **feed** de Gentle Shell (`desktop-feed/v1`) | feed | Siempre, para toda sesión. La política de seguridad de Gentle AI bloquea la carpeta del feed a las tools del agente (SK2a); la lee y escribe solo el código del kit, con los límites de D50 |
| **Orca**: `orca terminal create --worktree path:<miembro> --title <miembro> --command gentle-shell`, `switch` y `close` | lanzador | Por defecto. La terminal se abre dentro del proyecto que el repo ya tiene en Orca (comprobado en SK2a: unos 2 s, arranca en PowerShell; después de `close`, `show` sigue respondiendo con `connected: false`, así que la sesión viva se mira con `list`) |
| **Windows Terminal**: `wt -w 0 new-tab -d <miembro> --title <miembro> gentle-shell` | lanzador | Si no hay Orca. Debería abrir una pestaña más en la ventana abierta, pero en SK2a abrió una ventana nueva: falta confirmar si había una abierta |
| **RPC de pi**: sesiones sin pantalla que hospeda el propio kit (`sala hospedar`, SK7b), lanzadas con `GENTLE_SHELL_INTERACTIVE_HOST=1` y habladas por un pipe con nombre (D51) | los dos | Opcional. Es el único que contesta todas las clases de pregunta. Medido en SK7a ([informe](MEDICIONES-SK7a.md)) |

  `options.launcher` en `sala.json` vale `auto` (Orca si responde, si no Windows Terminal), `orca` o `wt`. **El kit no depende de repo-panel**: funciona en terminal pura o con Orca, y el panel es una capa superior que consume el kit (D30), nunca al revés.
- **D15.** **No se usa el correo de orquestación de Orca ni se lee su pantalla.** En el piloto, el coordinador tenía que ser una terminal de Orca, `--agent pi` no estaba configurado y `orca terminal wait --for tui-idle` dio la sesión por ociosa mientras seguía trabajando. `sala esperar` vigila en cambio `activity.state` en el snapshot del feed: cambia en menos de 16 ms y **nunca dice `idle` mientras quedan subagentes o trabajos** (dice `waiting`). La sala lo corre como trabajo en segundo plano de Gentle Shell y **duerme sin gastar tokens** hasta que el script termina y la despierta.
- **D16.** **El veredicto tiene reglas por comando**, definidas en el kit y no en el prompt. Por ejemplo:
  - después de entregar: rama, último commit, PR y CI;
  - después de volver a la base: en la base, limpio y al día.

  Las reglas son por resultado (`entrega` y `base`) y los comandos son alias: `miembro-entregar` y `miembro-base` (D21) son los definitivos, y `flow-ship`, `flow-pr` y `flow-base` son un puente que se quita en SK5c (D26). Decidido por la persona el 2026-11-21, en SK2d.
- **D17.** **Preguntas.** Toda decisión de la sala con alternativas finitas se pregunta con `ask_user_choice`: la opción recomendada primero y texto libre solo si la respuesta es abierta. Las preguntas de un miembro llegan por `pendingQuestion` del feed y **la sala las muestra completas en su chat**, de cualquier clase. La persona contesta libremente en el input de la sala, y la sala **nunca contesta por su cuenta**. Cómo llega la respuesta al miembro depende de la clase de pregunta:

| Clase de pregunta | Por el feed (sesión en Orca o Windows Terminal) | Por RPC (SK7) |
|---|---|---|
| Una pregunta de una opción | `sala responder` la entrega con `answer_question` | La entrega |
| Varias preguntas, varias opciones, diálogos de extensiones | **Se contestan en la pestaña del miembro**: la sala la muestra con `orca terminal switch`, o dice el título de la pestaña en Windows Terminal | La entrega |
| Consentimientos (revisión de un proveedor, permiso de mantenimiento) | **En la pestaña del miembro**: Gentle Shell nunca los acepta por la bandeja | **Solo la persona, con `sala consentir` en una terminal real** (D48) |

## Fusionar y seguir

- **D18.** `sala fusionar <miembro> <n>` encadena:
  1. comprueba que el PR esté en verde y sea fusionable;
  2. fusiona con el método que el repo permite;
  3. vuelve a la base en el miembro;
  4. corre la puerta;
  5. si da LISTO, pide la tarea siguiente, salvo que su fila diga `Auto: no`.

  Se detiene en el primer paso que falla y deja cada paso en un registro.
- **D19.** **Solo con el OK explícito de la persona, PR por PR.** El mensaje de la persona («fusioná el #11 de brand») es el OK. **Una fusión que la sala no hizo no dispara nada**: la persona puede estar fusionando otro repo que no es de la sala.

## Comandos

- **D20.** **Comandos de la sala**, plantillas de Gentle Shell que escribe la persona: `/sala-plan`, `/sala-estado`, `/sala-orden`, `/sala-entregar <miembro>`, `/sala-fusionar <miembro> <n>`, `/sala-seguir <miembro>`, `/sala-adoptar`, `/sala-soltar <miembro>` y `/sala-revisar`. Cada uno llama a su subcomando; así la sala no interpreta frases libres. El plan se aprueba por número («dale 1, 3 y 4»).
- **D21.** **Comandos del miembro**, que manda la sala o escribe la persona en el repo: `/miembro-tarea <ID>`, `/miembro-entregar`, `/miembro-base` y `/miembro-informe`. Son prompts nuevos y propios del kit, que no dependen de flow-skills. Hecho en SK5b para la entrega: `/miembro-entregar` maneja el motor copiado en la conversación del miembro, sin subagente (el kit todavía no instala agentes, D34), por `sala motor`, que lo corre sin shell y revisa el título del PR antes de que el motor lo selle; `/miembro-base` vuelve a la base solo con avance rápido. Hecho en SK5f para lo demás, con lo que proponía la fila: `/miembro-tarea [ID]` es lo propio del kit de `/flow-next <ID>` (la puerta, la fila siguiente o la nombrada, las condiciones para arrancar sin preguntar y el camino de las filas migradas) y `/miembro-informe` lo de `/flow-avance`, que solo informa. Desde SK5f la sala manda estos comandos, nunca `/flow-*`.
- **D22.** **El motor de entrega se copia, no se reescribe.** `flow-commit` (unas 2.400 líneas transaccionales: bloqueo, reversión, índice vacío obligatorio, detección de merge o rebase en curso) y `flow-pr` (unas 790 líneas: base resuelta sin adivinar, actualización de un PR existente, verificación con `gh`) van **copiados dentro del kit, con su versión anotada**. `/miembro-entregar` los usa. Reescribirlos sería riesgo puro sobre el historial de Git. Medido al copiarlo (SK5a): `flow-pr` son en realidad unas 3.260 líneas, porque `flow-pr.mjs` usa cuatro módulos de `scripts/lib/`; con `flow-commit`, la copia suma unas 5.670 líneas. Vive en `engine/`, con su origen y el SHA-256 de cada archivo en `engine/source.json`, y una prueba falla si la copia cambia sin regenerarlo.
- **D23.** **Formato de commits y PR**, configurable desde `sala.json`:
  - el formato de flow-commit: `tipo(ámbito)!: resultado` (Conventional Commits 1.0), con **el ámbito opcional**;
  - **el título del PR se valida con la misma regla** que el commit;
  - **el ID de la tarea siempre al final, entre paréntesis**: `docs(guide): document theme H (M2c)`;
  - un **límite suave de 72 caracteres** en el título;
  - el **idioma** de los PR desde `options.language`;
  - las secciones del PR: Summary, Changes, Validation, Risks y Out of scope, con «Not run» en vez de pruebas inventadas;
  - **Jira con su interruptor** (`options.jira`): apagado en upen; en h2o se resuelve después.
  - Hecho en SK5e: lo revisa una capa del kit, `src/formato.js`, antes de llamar al motor, sin editar `engine/`. Con Jira prendido, por ahora solo se pide una clave (`ABC-123`) en el título; si h2o necesita otra cosa, se cambia ahí.

## Adopción y requisitos

- **D24.** **Catálogo de requisitos**, versionado en el kit. Cada requisito tiene un id, una comprobación (script) y la orden para cumplirlo. Los primeros:
  - `docs/ROADMAP.md` con el formato de tareas y su cabecera;
  - el bloque administrado de la sala en `AGENTS.md`;
  - la rama base y el remoto de `sala.json`.
- **D25.** **`/sala-adoptar` es una conversación:**
  1. pregunta qué carpetas mirar;
  2. corre `sala revisar` en cada repo;
  3. muestra con opciones cuáles adoptar y los agrega a `sala.json`;
  4. a los que no cumplen les manda, con el OK de la persona, la orden de ponerse en condiciones;
  5. los vuelve a revisar.

  `/sala-soltar <miembro>` saca un repo de la sala sin tocar el repo.

  **Cómo quedó en SK4a** (aprobado por la persona el 2026-11-21, al empezar):
  - **La sala nunca escribe en un miembro.** `sala adoptar` solo toca `sala.json`.
  - **El bloque del miembro lo pone el propio miembro**, con `sala unirse`, en una tarea con su PR: así su base no queda sucia. Si `AGENTS.md` tiene reglas propias sin las marcas, `sala unirse` deja un `.sugerido` y el miembro lo pasa con el OK de la persona.
  - **La orden de ponerse en condiciones es `sala condiciones <miembro>`**: la arma el kit con lo que falla en `sala revisar` y va con las guardas de `sala enviar`.
  - **`sala adoptar` deduce** el id y el prefijo del nombre de la carpeta, el remoto (`origin`) y la base (`origin/HEAD`), y cada dato se puede pasar con su flag.
- **D26.** **Quién manda en los miembros: la sala.** El kit instala su propio bloque administrado en el `AGENTS.md` de cada miembro. El bloque `panel:entrega` de repo-panel, que hoy dice que la entrega es **solo** con `/flow-*`, choca con `/miembro-entregar`. Se retira de los miembros en la fase 5, **no antes**: hasta entonces los miembros siguen con `/flow-*` y no hay choque.

## Actualizar las salas

- **D27.** **El kit se instala una vez en la máquina**, con la CLI y los comandos, y todas las salas usan esa copia: mejorar un comando mejora todas las salas. Cada sala anota en `sala.json` con qué versión quedó (`kit`). `sala actualizar`:
  - migra `sala.json` si cambió su formato;
  - reescribe los bloques administrados del `AGENTS.md` de la sala, que son el texto entre marcas, sin tocar lo de afuera;
  - vuelve a revisar a los miembros y propone, con OK, la orden de ponerse en condiciones.

  El `CHANGELOG.md` del kit dice qué trae cada versión.

## El modelo y las sesiones

- **D28.** **Un modelo más barato para la sala**, porque con los scripts solo coordina y resume. Se aplica con la acción `apply_profile` del feed, que liga un perfil de modelo **solo a esa sesión** (`options.roomModel` nombra el perfil), **sin tocar ninguna configuración global**. Los miembros siguen con el modelo fuerte para implementar.
- **D29.** **Una sesión nueva por unidad en cada miembro.** La bandeja no acepta `/new` ni `/quit`, así que reinicia el lanzador: después de la cadena de fusión, la sala **cierra la terminal del miembro** (`orca terminal close`), abre una nueva con contexto limpio y le manda la tarea siguiente. Solo cierra si:
  - la sesión está libre, sin subagentes ni trabajos;
  - no tiene ninguna pregunta abierta;
  - el árbol está limpio y la tarea está fusionada;
  - la terminal **la abrió la propia sala** (su handle está en `.sala/estado.json`). Nunca cierra una terminal de la persona.

  Si algo falla, pregunta. Es zona crítica. Arrancar cuesta unos 45 s; gasta menos contexto y se confunde menos.

## Relación con repo-panel

- **D30.** **Arquitectura hexagonal.** sala-kit es el núcleo y **no depende del panel**: funciona solo, en terminal pura o con Orca. repo-panel es una capa superior que consume el kit. El panel hospeda sus propias sesiones por RPC y desde ahí contesta todo, también desde el iPhone; es el ejemplo de cómo resolver preguntas y respuestas, no una dependencia. El panel va a consumir el kit, ya sea por su JSON o importándolo como librería: Conformity usa `sala revisar`, el plan usa `sala plan` y los botones usan `sala enviar`.
- **D31.** **repo-panel está en pausa** desde el 2026-11-20, por decisión de la persona, hasta que el kit funcione. Su fila RP255 replantea el panel sobre el kit. Si los dos repos se fusionan o quedan separados se decide entonces.

## Lo propio de upen (no va en el kit)

- **D32.** `TABLERO.md` deja de copiar el estado de las filas (por eso se desactualiza; pasó con M2c) y guarda solo lo que no está en ningún roadmap: orden entre carriles, prioridades, el piso del evento, puertas y lo que espera a la persona. `ESTADO.md` se recorta. Las reglas de coordinación pasan a un archivo que la sala lee solo cuando coordina. Es la fase 6 y se escribe en upen-ceo.

## Por comprobar

| Qué | Por qué importa | Dónde se comprueba |
|---|---|---|
| Que una acción real por la bandeja funcione en una sesión de Orca: `send_prompt` y `answer_question`. En SK2a no se pudo medir porque la política de seguridad bloquea la carpeta del feed a las tools del agente; se mide con la CLI, según D50. SK2f ya lee el feed real con la CLI; SK2c programa `sala enviar` con una bandeja falsa, y falta mandar una acción real. También falta saber si Gentle Shell escribe el snapshot de una vez (`sala esperar` tolera lecturas a medias) | D13, D15, D17, D46 y D50 | Primer `sala enviar` real, con el OK de la persona |
| Que `wt -w 0 new-tab` abra una pestaña en la ventana abierta. En SK2a abrió una ventana nueva; SK2b lo programó con lanzadores falsos, sin medirlo | D14 | Primer uso real de `sala abrir` con `wt`, con la persona |
| Que `sala abrir` con el Orca real deje Gentle Shell listo en el proyecto del miembro y lo reuse al correrlo de nuevo. SK2b lo probó con un `orca` falso | D14 | Antes de SK2c, con el OK de la persona |
| Que un consentimiento de revisión llegue por RPC como el `select` que describe el código (`lib/review-consent-ui.ts`) y que el anfitrión lo reconozca. SK7a no lo midió en vivo: hace falta una revisión real | D48 | SK7c, con el OK de la persona |
| Que `sala hospedar` con el Gentle Shell real arranque la sesión por `cmd.exe /d /s /c gentle-shell --mode rpc`, que `sala enviar` y `sala responder` le lleguen y que un `ask_user_question` de dos partes se conteste desde la sala. SK7b lo programó con un pi RPC falso | D51 | Primer `sala hospedar` real, con el OK de la persona |
| Por qué falla el `git fetch` dentro de `estado-vivo.sh` | Que `sala estado` no repita el error | SK1a |
| Que `apply_profile` por la bandeja ligue el perfil solo a esa sesión. Resuelve la duda anterior de pasar un modelo por parámetro. El formato público de Gentle Shell 4.9.0 lo dice (modo `session`, nunca el global), y SK3c lo programó con una bandeja falsa | D28 | Primer `sala modelo` real, con el OK de la persona |
| Que `orca terminal close --tab` termine el proceso de Gentle Shell, como midió SK2a, y que `sala reiniciar` abra la sesión nueva. SK3c lo programó con un `orca` falso | D29 | Primer `sala reiniciar` real, con el OK de la persona |

Comprobado en SK2a ([informe](MEDICIONES-SK2a.md)): una sala ociosa se despierta cuando termina su trabajo en segundo plano (D15); `orca terminal create --worktree`, `switch` y `close` funcionan dentro del proyecto de Orca (D14 y D29); y `ask_user_choice` se ve y se elige bien en la terminal de Orca (D17).

## Decisiones de la segunda ronda (2026-11-20)

Salen de dos revisiones de solo lectura: el proyecto `escritorio-ia-kit` y cómo instala y descubre comandos Gentle Shell (pi). La persona las aprobó todas el mismo día y dio su OK para registrar el kit en la configuración de Gentle Shell.

### Instalación y nombres de los comandos

- **D33. El kit es un paquete de pi, referenciado en su lugar**, como flow-skills: `package.json` con la clave `pi` (`prompts` y `skills`), registrado una vez en el `settings.json` de Gentle Shell. pi lo lee desde la carpeta del repo, sin copiar, así que actualizar es `git pull` y `/reload`. Esto cumple D27. Ojo: la máquina tiene dos casas, `~/.gentle-shell/agent`, la que usa Gentle Shell, y `~/.pi/agent`, la de pi solo. Registrado el 2026-11-20 en las dos casas, con el OK de la persona.
- **D34. Los agentes propios se copian.** Un paquete de pi no instala agentes. Los de flow-skills se copian a mano a `agents/` y quedaron con un modelo agregado localmente. Si el kit necesita agentes, por ejemplo el de entrega con un modelo más barato, `sala instalar` los copia con su versión, y `sala revisar` avisa cuando la copia quedó vieja. Hecho en SK5d con lo que la persona eligió el 2026-11-21: el kit trae un agente, `miembro-entrega`, en `agents/`; no fija modelo (lo elige la persona con sus perfiles de modelos) y su cuerpo apunta a los pasos de `prompts/miembro-entregar.md` del kit instalado. `/miembro-entregar` le delega la entrega si está instalado y, si no, la hace en su conversación. La copia termina con una marca con la versión y el hash de lo escrito; una copia editada o un archivo ajeno con el mismo nombre no se pisan sin `--forzar`.
- **D35. Comandos globales con guarda**, en lugar de comandos por carpeta. pi puede cargar comandos solo en un proyecto (`.pi/settings.json`), pero eso escribe en cada miembro y pide confiar en la carpeta (`/trust`). Más simple: instalarlos globales, y que cada comando primero pregunte a la CLI dónde está y se niegue en la carpeta equivocada, por ejemplo un comando de sala fuera de una sala.
- **D36. Un prefijo por familia: `sala-` para los comandos de la sala y `miembro-` para los de los miembros.** El buscador de `/` de pi es difuso y premia los inicios de palabra, que también cuentan después de un `-`. Por eso **escribir `/plan` igual encuentra `/sala-plan`**: el prefijo no cuesta letras.
  - Con `/sala` aparecen todos juntos, como `/flow`.
  - Se evitan choques con otros paquetes instalados que no se revisaron.
  - Con `/` solo, la lista sale en el orden de su origen, no alfabética: el prefijo agrupa recién cuando escribís algo.

| Familia | Comandos |
|---|---|
| Sala | `/sala-plan`, `/sala-estado`, `/sala-orden`, `/sala-entregar`, `/sala-fusionar`, `/sala-seguir`, `/sala-adoptar`, `/sala-soltar`, `/sala-revisar`, `/sala-pausar` |
| Miembro | `/miembro-tarea`, `/miembro-entregar`, `/miembro-base`, `/miembro-informe` |

### Lo que conviene tomar de escritorio-ia-kit

- **D37. Retomar leyendo un archivo.** Al arrancar, la sala corre un resumen corto del estado vivo, por ejemplo `sala estado --retomar`, y no relee documentos largos. La regla: lo que no está en el archivo no pasó. Viene de `scripts/obra.mjs` y `estado/obra.json`. Refuerza D5.
- **D38. `sala pausar` y `sala seguir`.** Un archivo `.sala/PAUSA` frena toda orden: `enviar`, `fusionar` y cualquier cadena en segundo plano lo miran primero. Solo la persona lo levanta, y una pausa de prueba vence sola. Viene de `scripts/pausar.mjs` y del hook `pausa`. No reemplaza el OK de cada fusión (D19).
- **D39. Pruebas de guardas sin modelo.** Se le pasan órdenes de ejemplo a un transporte falso y se comprueba que se acepten o se nieguen. Si la entrada no se puede leer, la orden se niega. Viene de `scripts/testar-travas.mjs`. Es el estilo de prueba de SK2c y SK4b.
- **D40. Cadenas con topes y registro.** Un tope de pasos y de tiempo, los argumentos sin pasar por una shell (`spawnSync` con lista), y una línea de registro por paso. Viene de `scripts/rodar-rotina.mjs`. Va en SK3b.
- **D41. Escribir sin pisar.** `sala init` y `/sala-adoptar` nunca sobrescriben: informan qué hicieron y qué saltearon. Si un `AGENTS.md` no tiene las marcas del bloque administrado, dejan al lado un archivo `.sugerido`. Viene de `scripts/iniciar.mjs`. Va en SK3a, SK4a y SK4b. **Reglas que chocan** (aprobado por la persona el 2026-11-21, al empezar SK3a): el bloque nunca dice que gana; si una regla de afuera lo contradice, el agente no elige y le pregunta a la persona. Las marcas viejas conocidas (como `panel:entrega`) se detectan con código y frenan la adopción (**cambiado en SK4a**, el 2026-11-21: avisan y no frenan, porque hasta la fase 5 el bloque del miembro no habla de entrega y no hay choque, D26); las contradicciones de reglas sueltas las lista el comando con modelo (`/sala-adoptar`, SK4a) citando líneas, y la persona decide. Nunca se borra texto fuera de las marcas.
- **D42. Requisitos de higiene.** El catálogo de `sala revisar` suma un tamaño máximo para `AGENTS.md` y que no haya secretos en `sala.json` ni en las reglas. Viene de `scripts/brain-lint.mjs`. Va en SK1c.
- **D43. Más adelante, opcional: evals de los comandos de la sala.** Casos en JSONL que comprueban conductas: la sala no contesta por la persona (D17) y no fusiona sin OK (D19). Llevan un tope de gasto. Viene de `evals/rodar.mjs`. Cuesta tokens. Hecho en SK8 con `evals/rodar.js`, con esta forma:
  - Gentle Shell no tiene una bandera de tope de gasto. El corredor abre `gentle-shell --mode rpc --no-session --no-mcp --tools read,grep,find,ls,ask_user_choice,ask_user_question` con la línea fija de `sala hospedar`, y suma el `usage.cost.total` de cada mensaje.
  - Al pasar el tope del caso, aborta la sesión. Al llegar al tope de la ronda, no corre más casos.
  - La sesión no tiene shell: dice `CORRERÍA: <comando>` y sigue con las salidas que simula el caso.
  - Medido el 2026-11-22 con el Gentle Shell real:
    - La sesión arranca por `cmd.exe /d /s /c` y las herramientas quedan en esas seis, sin bash. Igual, el corredor hace fallar el caso que use otra.
    - Un caso cuesta unos US$ 0.13 y tarda unos 2 minutos y medio.
    - Gentle Shell suelta la carpeta unos segundos después de que termina `cmd.exe`: el borrado de la sala temporal reintenta.
- **D44. Más adelante, opcional: programar el plan del día** con un comando que **imprime** la tarea programada de Windows y nunca la instala. Viene de `scripts/agendar.mjs`.

**No se toma:**
- el commit hecho por el agente (`obra.mjs --commit`);
- la entrevista larga guiada por prosa;
- su tablero visual, que duplica repo-panel;
- el runner para varios proveedores;
- verificar respuestas del modelo con expresiones regulares como prueba principal: el veredicto sigue siendo determinista (D16).

## Decisiones de la tercera ronda (2026-11-20)

- **D45. La cola de la sala.** Es una lista única con las tareas pendientes de todos los miembros, en el orden en que la sala las va a ejecutar, agrupada en **olas**. Una ola es lo que puede correr en paralelo.
  - **Se calcula, nunca se guarda.** No hay archivo que sincronizar, así que no se puede desactualizar como `TABLERO.md`. Se recalcula en el plan del día, después de cada `sala fusionar` y cada vez que el panel refresca. Es mecánica, sin modelo; el modelo lee solo el resultado, unos 2 KB.
  - **Las fuentes**, de más fuerte a más débil:
    1. las dependencias: las de dentro del repo, con IDs de su tabla, y las de otro miembro, con prefijo (`CORE-E09`);
    2. el orden de las filas dentro de cada roadmap;
    3. la prioridad entre miembros, escrita en `sala.json`: el orden de `members` y una lista opcional de tareas fijadas adelante. Es lo único manual, y es intención de la persona, no estado.
  - **Qué cuenta como hecho.** El roadmap se lee de la rama base remota, después del mismo `fetch` de `sala estado`. Una tarea está hecha cuando su fila dice `Completada` **ahí**. Lo que está en vuelo (una rama o un PR con el ID) sale «en revisión», no hecho, así la cola no adelanta trabajo sin fusionar.
  - **Un miembro, una tarea por ola**, porque cada miembro tiene una sola sesión y una sola rama a la vez (D29).
  - **Lo que no avanza sale con su motivo**:
    - espera a otra tarea, con el ID;
    - `Bloqueada`, con su nota;
    - espera a la persona;
    - dependencia sin resolver, por ejemplo un ID mal escrito;
    - ciclo de dependencias;
    - miembro que no se pudo leer.
  - **Salida.** `sala plan` suma el campo `queue` con las olas, y cada elemento lleva el miembro, el ID, la entrega, lo que espera y el motivo. Con `--texto`, una línea por ola.
  - **Dónde se ve.** En la terminal, como texto. La vista visual es de repo-panel, en Rooms, dentro de su replanteo (RP255). En Gentle Shell no va un widget: lo decidió la persona el 2026-11-20, porque las visualizaciones van al panel.
  - **El riesgo que queda: un PR que se fusiona sin marcar su fila `Completada`.** Lo cubre `sala veredicto` (D16): después de entregar, comprueba que la fila de la tarea del PR diga `Completada` y, si no, lo avisa antes de fusionar.

## Decisiones de la cuarta ronda (2026-11-20)

Salen del análisis de Gentle Shell Desktop (PR 3277 de gentle-shell, `docs/gentle-shell-desktop.md` y `docs/desktop-feed.md`). La persona las aprobó el mismo día.

- **D46. El adaptador feed.** Cada sesión interactiva de Gentle Shell (TUI o host RPC) publica `<agentDir>/desktop/sessions/<id>.json` y tiene una bandeja de acciones. Comprobado el 2026-11-20 en esta máquina: había 7 sesiones con su snapshot, las de Orca en modo `tui` y las de repo-panel en modo `rpc`.
  - **Mirar:** lee los snapshots de `~/.gentle-shell/agent` y `~/.pi/agent`, más las carpetas que agregue `sala.json`. Cruza cada sesión con su miembro por `identity.cwd` y `realCwd` contra `path`. Una sesión cuenta como viva mientras su `identity.pid` corre.
  - **Qué da gratis:** `activity` (estado y su texto), `pendingQuestion`, el modelo, el perfil, el modo de permisos, el contexto, el costo, `usage` (las ventanas del plan), `todo`, subagentes, trabajos, cambios y la lista de comandos.
  - **Actuar:** deja una acción en `desktop/inbox/<sesión>/<id>.json` y lee la respuesta en `outbox`: `send_prompt`, `answer_question` (con `via: "session"`), `abort_turn`, `cancel_job`, `cancel_subagent`, `set_permission_mode` (subir el modo se niega mientras la sesión trabaja), `refresh_usage` y `apply_profile`.
  - **Contrato:** lee solo `gentle-shell.desktop-feed/v1`. Ante otra versión no adivina: avisa con el motivo (D47).
  - **Límites:** no abre sesiones (eso es del lanzador); no trae la conversación (para el resumen de un miembro se lee `identity.sessionFile`); y una sesión que arrancó antes de esta función no tiene bandeja hasta que se reinicia.
  - **Privacidad:** el snapshot trae rutas y el texto de las preguntas. Nunca se expone por un servidor.
- **D47. El contrato con Gentle Shell.** Dependemos de Gentle Shell y de pi, que son el agente; de todo lo demás, lo menos posible y detrás de un adaptador.
  - **Parte mecánica, sin tokens:** el kit anota con qué versión de Gentle Shell y qué formato del feed se probó. Hay pruebas de contrato con snapshots reales guardados de muestra, sin datos privados. `sala revisar` compara lo instalado con lo anotado y avisa antes de que algo falle en el día a día.
  - **Parte con modelo, a pedido:** `/sala-novedades` lee qué cambió en Gentle Shell desde la última versión revisada (su changelog y sus documentos del feed). Dice qué hay que **ajustar** para seguir funcionando y qué es **nuevo y útil**; lo que la persona elija entra como filas del roadmap.
- **D48. Consentimientos que pasan por la sala.** *Reemplazada el 2026-11-21 por la decisión de SK7a, más abajo; el texto original queda para la historia.* Una respuesta de consentimiento solo la entrega un transporte que pueda hacerlo (RPC, SK7). `sala responder` la entrega únicamente si comprueba, de forma mecánica, que **el último mensaje escrito por la persona en la sala** (no uno del agente) es posterior a la pregunta y contiene esa respuesta. Además queda en el registro. Es zona crítica y va en PR propio, con una prueba que reproduce a la sala intentando contestar sola. Por el feed, Gentle Shell ya niega los consentimientos: se contestan en la pestaña del miembro.
- **D49. Contestar desde cualquier dispositivo.** Decisión de la persona del 2026-11-20: contestar desde el teléfono es tan seguro como desde la computadora. El kit no restringe **dónde** contesta la persona; solo controla que un **agente** no conteste por ella (D17 y D48).

## Decisiones de la quinta ronda (2026-11-20)

- **D50. Cómo lee el feed la sala: una excepción acotada.** Decisión de la persona del 2026-11-20, al empezar SK2f. Gentle Shell niega toda la carpeta `<agentDir>/desktop/` a las tools del agente (`read`, `bash` y las demás), a propósito: un modelo manipulado podría dejar acciones en la bandeja con la autoridad de la persona. El feed está hecho para que lo lea otro programa (la app de escritorio Herdr), y la CLI `sala` es otro programa, pero la corre el modelo de la sala: la guarda no la ve. No hay una vía oficial para orquestadores (pedirla a Gentle Shell se descartó) y el canal entre agentes (`orchestrator_list`) no estaba disponible al medirlo. Por eso la persona aprueba esta excepción, con estos límites:
  - **Quién entra:** solo el código del adaptador (`src/feed.js`). El modelo de la sala nunca lee ni escribe la carpeta con sus tools, ni la nombra en un comando.
  - **Qué lee:** solo `sessions/*.json` y las respuestas de sus propias acciones en `outbox/`, y del snapshot solo los campos que el kit usa.
  - **Qué escribe:** en `inbox/` solo `send_prompt`, `answer_question` de una opción y `apply_profile` con solo el nombre del perfil (D28, sumada en SK3c con el OK de la persona del 2026-11-21). La lista es cerrada y la fija el código; una prueba reproduce el intento de mandar otra acción (`set_permission_mode`, `abort_turn`, `cancel_*`, `refresh_usage`) o un `apply_profile` con su `confirmation`, y comprueba que se niega sin escribir nada: la confirmación de un perfil es siempre de la persona. Sumar otra acción es otra decisión de la persona.
  - **Lo que ya frena Gentle Shell:** un prompt de la bandeja llega como `extension` y nunca cuenta como palabra ni consentimiento de la persona; se niega con una pregunta abierta y para los comandos que solo corren en la terminal; los consentimientos no se contestan por la bandeja.
  - **Riesgo que queda:** un modelo de la sala manipulado podría mandarle un prompt dañino a un miembro por `sala enviar`. Lo acotan la lista cerrada, las guardas de D13 y el OK de la persona antes de cada orden.
  - **Cómo se deshace:** si Gentle Shell ofrece una lectura oficial, el adaptador la usa y esta excepción se borra. La alternativa sin excepción es el transporte RPC (SK7).

## Decisiones de la sexta ronda (2026-11-21)

Salen de las mediciones de SK7a ([informe](MEDICIONES-SK7a.md)). La persona las tomó el mismo día.

- **D48, nueva versión. Los consentimientos de una sesión hospedada los da la persona en una terminal real.** La versión original pedía leer «el último mensaje escrito por la persona en la sala», pero SK7a midió que no es mecánico: en el archivo de sesión de pi una entrada de usuario no guarda su origen (`interactive`, `rpc` o `extension`), así que un mensaje tipeado no se distingue de uno de la bandeja o de una extensión, y las herramientas del agente pueden escribir ese archivo (la guarda de Gentle Shell cubre solo `desktop/`). En su lugar:
  - el anfitrión **retiene** todo diálogo que reconozca como consentimiento y nunca lo contesta por `sala responder`;
  - lo entrega solo `sala consentir <miembro>` (la respuesta no va como argumento; ver la nota de SK7c) corrido en una **terminal interactiva**: el anfitrión acepta la respuesta solo si el pedido viene de un proceso con `stdin` y `stdout` en una TTY y la persona tipea la respuesta en ese momento. El `bash` de las herramientas del agente no tiene TTY, así que el modelo de la sala no puede contestar;
  - queda en el registro, y una prueba reproduce a la sala intentando contestar sola (sin TTY, o con la respuesta como argumento);
  - **el límite que se acepta:** un consentimiento no se contesta desde el teléfono ni desde el input de la sala, aunque D49 lo permite para las demás preguntas.
  - **Cómo quedó en SK7c (2026-11-21).** La respuesta no va como argumento: `sala consentir <miembro>` se niega si recibe una, porque un argumento lo escribe el modelo. Muestra las opciones numeradas y lee el número que la persona tipea. El anfitrión suma la acción `consent`: entrega solo un diálogo que reconoció como consentimiento, con una de sus opciones, y solo si el pedido trae `tty: true`; `answer` los sigue negando. El pipe no ve la terminal de quien le habla, así que esa marca la pone la CLI: frena al modelo de la sala, que corre sin terminal, y no a un proceso que mienta. Cada intento queda en `.sala/ordenes.log` (`consented` o `refused`).
- **D51. El canal del anfitrión es un pipe con nombre.** `sala hospedar <miembro>` (SK7b) lanza `gentle-shell --mode rpc` con `GENTLE_SHELL_INTERACTIVE_HOST=1` en la carpeta del miembro y lo mantiene vivo, porque arrancar tarda más de un minuto. Escucha con `net.Server` en `\.\pipe\sala-<instancia>-<miembro>` en Windows, y en un socket dentro de `.sala/` en Linux y Mac. Sin dependencias ni sondeo.
  - **Las guardas viven en el anfitrión,** no en la CLI: la CLI la corre el modelo de la sala, así que lo que se niega (la pausa, una acción fuera de la lista, un consentimiento sin TTY) se niega en el proceso que habla con pi;
  - lee stdout cortando solo en LF, nunca con `readline`, que también corta en U+2028 y U+2029;
  - contesta solo los diálogos que esperan respuesta (`select`, `confirm`, `input`, `editor`); los avisos (`notify`, `setStatus`, `setWidget`) se descartan;
  - la sesión hospedada publica su snapshot en el feed como cualquier otra (D46), así que `sala estado` y `sala esperar` la miran igual.
  - **Cómo quedó en SK7b (2026-11-21).** El nombre del pipe lleva además una etiqueta de 8 caracteres sacada de la carpeta de la sala (`sala-<instancia>-<etiqueta>-<miembro>`), así dos salas con el mismo nombre no comparten pipe. Un pedido por conexión, una línea JSON de ida y una de vuelta, con cuatro acciones: `status`, `prompt`, `answer` y `close`. El anfitrión no manda una orden mientras la sesión trabaja (entre `agent_start` y `agent_settled`) ni con un diálogo abierto, y no la cierra en esos casos. Un consentimiento se reconoce por sus palabras (`granted`, `declined` o `consent` en el título, el mensaje o las opciones, sin invisibles): ante la duda se retiene. Si el miembro ya tiene una sesión viva en el feed, `sala hospedar` no abre otra. El pipe no lleva una clave: cualquier proceso de la persona puede hablarle, pero solo con esas cuatro acciones y las guardas del anfitrión.
