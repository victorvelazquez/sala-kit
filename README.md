# sala-kit

El motor reutilizable de una **sala**: una sesión de Gentle Shell que coordina varios repositorios (los **miembros**) mientras una persona decide.

> Estado: **fase 3**. La CLI `sala` crea una sala (`sala init`), la mira (`sala estado`, `sala plan`, `sala revisar`), abre y muestra sesiones, manda órdenes, junta preguntas y juzga entregas; los comandos `/sala-*` la usan desde Gentle Shell.

## La idea en tres piezas

| Pieza | Dónde vive | Qué tiene |
|---|---|---|
| **El kit** | Este repositorio, instalado una vez en la máquina | La CLI `sala`, los comandos de la sala y de los miembros, el catálogo de requisitos, las plantillas y los adaptadores de transporte. Nada de ningún proyecto |
| **La instancia** | La carpeta de cada sala (por ejemplo `upen-ceo`) | `sala.json` con los miembros y las opciones, y la estrategia propia en Markdown |
| **El estado vivo** | `.sala/estado.json` dentro de la instancia, sin versionar | Las sesiones abiertas, las órdenes en vuelo y las aprobaciones pendientes |

## Instalar la CLI

Una vez por máquina, desde la carpeta del repo:

```
npm link
```

Deja el comando `sala` en el `PATH` apuntando a este repo, así que actualizar es `git pull`. Para quitarlo: `npm unlink -g sala-kit`. Sin instalar, lo mismo se corre con `node bin/sala.js`.

## `sala init` y los comandos de la sala

`sala init [--sala <carpeta>]` crea una sala en la carpeta (la actual por defecto; si no existe, la crea):

| Archivo | Qué deja |
|---|---|
| `sala.json` | La sala sin miembros, con el nombre de la carpeta. Los miembros se suman a mano o, más adelante, con `/sala-adoptar` |
| `AGENTS.md` | El bloque administrado de la sala entre `<!-- sala-kit:sala:inicio -->` y `<!-- sala-kit:sala:fin -->`: qué es la sala, sus comandos y la regla de preguntas |
| `.gitignore` | La línea `.sala/`, el estado local que no se commitea |

**Nunca pisa nada.** Lo que ya existe se saltea y la salida dice qué hizo y qué salteó; un `sala.json` que ya estaba y no es válido se saltea con un aviso. Antes de escribir lee todo: si no puede leer un archivo, no escribe ninguno. Se niega en la carpeta de un miembro. Si `AGENTS.md` ya existe con reglas propias y sin las marcas, queda igual, y el bloque va a `AGENTS.md.sugerido`, con un aviso: revisá si alguna regla choca con el bloque y pasalo a mano, con sus marcas. Si `AGENTS.md` ya tiene el bloque, no se toca: ponerlo al día es trabajo de `sala actualizar`. El bloque no dice que gana: si una regla de afuera lo contradice, la sala le pregunta a la persona.

`sala donde [--sala <carpeta>]` dice si la carpeta es una `sala` (tiene `sala.json`), un `miembro` (su `AGENTS.md` tiene el bloque del miembro) o `ninguna`. Es la guarda de los comandos de la sala, que se instalan globales con el kit (`prompts/` en `package.json`) y se niegan fuera de una sala:

| Comando | Qué hace |
|---|---|
| `/sala-plan` | Muestra el plan numerado; por cada número que aprobás, le manda la tarea a su miembro |
| `/sala-estado` | La foto de los miembros y sus sesiones, primero los que te necesitan. Solo lee |
| `/sala-orden <miembro> <orden>` | Manda la orden tal cual con `sala enviar` y espera a que el miembro termine o te necesite |
| `/sala-entregar <miembro>` | Le pide la entrega con `/miembro-entregar`, espera y muestra el veredicto |
| `/sala-seguir <miembro>` | Comprueba que esté en su base y le pide la tarea siguiente con `/miembro-tarea`. No es `sala seguir`, que levanta una pausa |
| `/sala-fusionar <miembro> <n>` | Fusiona el PR #n del miembro con `sala fusionar` y muestra cada paso. Escribirlo con el número es el OK para ese PR, y solo ese (D19) |
| `/sala-adoptar [carpetas]` | Adopta las carpetas con `sala adoptar`, las revisa y, con tu OK por miembro, le manda la orden de ponerse en condiciones (`sala condiciones`) |
| `/sala-soltar <miembro>` | Con tu OK, saca al miembro de la sala con `sala soltar`; su repositorio queda igual |
| `/sala-pausar [minutos \| seguir]` | Pone la sala en pausa con `sala pausar` (con minutos, una pausa de prueba que vence sola) o la levanta con `sala seguir` |

## `sala.json`

Va en la carpeta de la sala. Se edita a mano:

```json
{
  "schema": 1,
  "kit": "0.1.0",
  "name": "upen",
  "members": [
    { "id": "core", "prefix": "CORE", "path": "C:/Users/victor/Developer/upen/upen-core", "base": "develop", "remote": "origin" }
  ],
  "pinned": ["CORE-E09"],
  "options": { "language": "en", "jira": false, "transport": "orca", "roomModel": null }
}
```

| Campo | Regla |
|---|---|
| `schema` | `1` |
| `kit` | La versión del kit con la que se escribió. `sala actualizar` la pone al día |
| `name` | El nombre de la sala |
| `members` | La lista de miembros. Puede estar vacía: así la deja `sala init` |
| `members[].id` | Minúsculas, dígitos y guiones, sin repetir. Es como se nombra al miembro en todos los comandos |
| `members[].prefix` | Mayúsculas y dígitos, sin repetir: el prefijo de los IDs de su roadmap (`CORE-E09`) |
| `members[].path` | Ruta absoluta a la raíz del repo |
| `members[].base` | La rama base: letras, dígitos, `.`, `_`, `-` y `/`, sin empezar con `-` |
| `members[].remote` | Opcional, `origin` por defecto. Es el nombre de un remoto del repo, nunca una URL (una URL puede llevar credenciales) |
| `pinned` | Opcional: las tareas que la persona pone adelante en la cola, con el prefijo del miembro (`CORE-E09`), sin repetir y en orden de prioridad. Es intención de la persona, no estado |
| `options` | Opcional: `language` (`es` o `en`, el idioma de los PR), `jira` (`true` o `false`; ver «El motor de entrega»), `transport`, `launcher` (`auto`, el valor por defecto, `orca` o `wt`; ver `sala abrir`) y `roomModel` (el nombre de un perfil de `/gentle:profiles` o `null`; ver `sala modelo`) |

Un campo desconocido es un error, para que una errata no pase callada.

## `sala estado`

```
sala estado [--texto] [--sala <carpeta>]
```

Por cada miembro, en paralelo: la rama, el árbol, el stash, si la base local es igual a la del remoto (después de un `git fetch`), los PR abiertos con su CI (`passing`, `failing`, `pending` o `none`) y la **puerta** con cada motivo por el que no está lista. Sale en JSON compacto (`{"schema":1,"sala":...,"members":[...]}`), que es un contrato: cambia con `schema`. Con `--texto`, una línea por miembro:

```
Sala upen
core   LISTO     develop
       sesión 01a1fb69: te necesita: «¿Seguimos con E09?» (contexto 13 %, costo 1.53)
brand  NO LISTO  feat: está en la rama feat, no en la base develop
       sesión 7c2e: esperando a sus agentes (contexto 40 %, costo 0.82)
```

Un miembro que falla (la carpeta no existe, el `fetch` no llega, `gh` no tiene sesión) no frena a los demás: queda como motivo. Git y `gh` corren sin shell y sin pedir credenciales, y las credenciales de una URL o un token nunca salen en la salida.

**La sesión viva de cada miembro** sale del feed de Gentle Shell (`gentle-shell.desktop-feed/v1`), sin leer ninguna pantalla y sin tokens. Se leen los snapshots de `~/.gentle-shell/agent` y `~/.pi/agent`; una sesión es de un miembro cuando su carpeta está dentro de su `path`, y cuenta mientras su proceso corre. En el JSON, cada miembro trae `sessions` (`id`, `mode`, `state`, `label`, `question`, `context` en %, `cost`), y `feed.warnings` dice qué snapshots no se pudieron leer (por ejemplo, un formato que no es la versión 1). `state` es `needs-you` (hay una pregunta abierta o algo la bloquea), `working`, `waiting` (terminó su turno pero quedan subagentes o trabajos) o `idle`. Un secreto en el texto de una pregunta sale solo con su tipo.

Esa carpeta la lee solo el código del kit (D50 en [`docs/DISENO.md`](docs/DISENO.md)): Gentle Shell se la niega a las tools del agente. En la bandeja de una sesión, el kit deja únicamente `send_prompt` y `answer_question` de una opción; cualquier otra acción se niega sin escribir nada.

**`sala estado --retomar`** es el resumen corto con el que arranca la sala (D37): por miembro, la terminal que abrió la sala (`opened`, de `.sala/estado.json`) y cada sesión viva con su estado, su texto y su pregunta abierta. No corre git ni `gh`, así que responde enseguida.

```
Sala upen
core   abierta por la sala en orca (term_3f2a…); sesión 01a1fb69: trabajando
brand  no la abrió la sala; sin sesión viva
```

## `sala abrir` y `sala mostrar`

```
sala abrir <miembro> [--texto] [--sala <carpeta>]
sala mostrar <miembro> [--texto] [--sala <carpeta>]
```

`sala abrir` deja Gentle Shell listo en el miembro. Si ya tiene una sesión viva en el feed, la reusa y no abre nada (`action: "reused"`). Si no, abre una terminal con el lanzador de `options.launcher`, espera hasta 60 s a que Gentle Shell publique la sesión y anota en `.sala/estado.json` el lanzador, el handle, el título de la pestaña y la sesión (`action: "opened"`).

| `launcher` | Qué abre |
|---|---|
| `auto` | Orca si responde; si no, Windows Terminal |
| `orca` | `orca terminal create --worktree path:<path> --title <miembro> --command gentle-shell`: una terminal dentro del proyecto que el repo ya tiene en Orca |
| `wt` | `wt -w 0 new-tab -d <path> --title sala-<miembro>`, con Gentle Shell dentro de PowerShell. Puede abrir una ventana nueva en vez de una pestaña (SK2a); una ruta con `;` se niega, porque `wt` la lee como otro comando |

Si la sesión no aparece a tiempo, `sala abrir` termina con error pero el handle queda anotado, para no perder la terminal abierta. Si `.sala/estado.json` no se puede leer, no se abre nada y el archivo no se pisa. Si una terminal de Orca que abrió la sala sigue abierta sin sesión, `sala abrir` se niega en vez de abrir otra. Un `sala abrir` a la vez por sala: lo cuida `.sala/abrir.lock`, que se borra al terminar; si una corrida se cortó a la fuerza, el candado vence a los 5 minutos o lo borrás vos. `.sala/` es estado vivo de la sala: no se versiona.

`sala mostrar` lleva la terminal de Orca que abrió la sala al frente (`orca terminal switch`), después de comprobar con `orca terminal list` que sigue abierta. En Windows Terminal no se puede elegir una pestaña desde afuera: dice su título. Cerrar sesiones llega en SK3c.

## `sala enviar` y `sala esperar`

```
sala enviar <miembro> <orden> [--texto] [--sala <carpeta>]
sala esperar <miembro> [--texto] [--sala <carpeta>]
```

`sala enviar` deja la orden (por ejemplo `/flow-avance`) en la bandeja de la sesión del miembro, como `send_prompt`, y espera hasta 10 s a que Gentle Shell la acepte. Antes de escribir nada comprueba las guardas del kit (D13):

- la sala no está en pausa: si existe `.sala/PAUSA` y no venció, no manda nada (ver `sala pausar`);
- el miembro está en `sala.json` y tiene **una sola** sesión viva, que es suya (con dos, se niega y dice sus IDs);
- esa sesión no tiene una pregunta abierta ni está bloqueada;
- la orden se puede leer: no está vacía (tampoco hecha solo de caracteres invisibles), no pasa de 4000 caracteres y no tiene caracteres de control ni de dirección (D39). Tampoco puede empezar con `-`.

Gentle Shell suma sus propias guardas: niega los comandos que solo corren en la terminal (`/new`, `/quit`, `/gentle:*`, las líneas `!`), y su respuesta sale en el error. Un mensaje de la sala nunca cuenta como consentimiento de la persona. Cada orden queda en `.sala/ordenes.log`, una línea JSON con la hora, el miembro, la sesión, la orden (con cualquier secreto enmascarado) y el resultado: `refused` si la negó una guarda del kit; `sending` antes de dejarla en la bandeja y, después, `sent` o el código con que la negó Gentle Shell. Si la línea `sending` no se puede escribir, la orden no se manda.

Git Bash convierte `/flow-avance` en una ruta (`C:/Program Files/Git/flow-avance`) antes de que la CLI la vea. `sala enviar` reconoce esa ruta y se niega; desde Git Bash, corré `MSYS_NO_PATHCONV=1 sala enviar core /flow-avance`.

`sala esperar` vigila el estado de la sesión en el feed y termina cuando el miembro termina **de verdad**: `idle` durante 3 s seguidos, para no confundir el momento antes de que arranque una orden recién mandada. Mientras dice `waiting` (le quedan subagentes o trabajos) sigue esperando (D15). Termina enseguida, con `state: "needs-you"` y la pregunta, si el miembro te necesita. Falla si la sesión se cierra o si pasan 30 minutos. Está pensada para que la sala la corra como trabajo en segundo plano y duerma sin gastar tokens hasta que termine.

## `sala pausar` y `sala seguir`

```
sala pausar [--minutos <n>] [--texto] [--sala <carpeta>]
sala seguir [--texto] [--sala <carpeta>]
```

`sala pausar` escribe `.sala/PAUSA` y, mientras exista, la sala no manda nada: `sala enviar`, `sala condiciones`, `sala reiniciar` y cada paso de `sala fusionar` se niegan diciendo que la sala está en pausa (D38). Lo que un miembro ya está haciendo sigue. Con `--minutos <n>` (mayor que 0 y hasta 1440, se aceptan decimales) es una pausa de prueba que vence sola; sin él dura hasta `sala seguir`. Una pausa que ya está puesta no se cambia, para que una de prueba no acorte una sin vencimiento. Un `.sala/PAUSA` vacío o que no se puede leer cuenta como una pausa sin vencimiento.

`sala seguir` borra `.sala/PAUSA` y dice si la sala estaba en pausa. Lo pide solo la persona, con `/sala-pausar seguir`. La pausa no reemplaza el OK de cada fusión (D19).

## `sala preguntas` y `sala responder`

```
sala preguntas [--texto] [--sala <carpeta>]
sala responder <miembro> <opción> --pregunta <id> [--texto] [--sala <carpeta>]
```

`sala preguntas` lista la pregunta abierta de cada sesión viva de todos los miembros, completa: el texto, las opciones, su `id` y dónde se contesta (D17). La `class` dice cómo:

- `option`: una pregunta de una opción. La sala la contesta con `sala responder`.
- `consent`: un consentimiento. Se contesta en la pestaña del miembro; Gentle Shell nunca lo acepta por la bandeja.
- `terminal`: cualquier otra (varias preguntas, un diálogo, una clase que el kit no conoce). Se contesta en la pestaña del miembro.

`sala responder` entrega la opción que eligió la persona, como `answer_question` con el índice de la opción. La sala nunca contesta por su cuenta: la respuesta sale solo si `--pregunta` es el `id` que mostró `sala preguntas` y esa pregunta sigue abierta, y si la respuesta es exactamente una de sus opciones. Si la pregunta cambió, se niega. A un consentimiento o una pregunta de la terminal no la contesta: muestra la terminal de Orca que abrió la sala, o dice el título de su pestaña de Windows Terminal. Cada intento queda en `.sala/ordenes.log`, con los secretos enmascarados.

## `sala hospedar`

```
sala hospedar <miembro> [--cerrar] [--primer-plano] [--texto] [--sala <carpeta>]
```

Es opcional: el kit funciona sin esto, con Orca o Windows Terminal y el feed. `sala hospedar` lanza en segundo plano una sesión sin pantalla del miembro, `gentle-shell --mode rpc` con `GENTLE_SHELL_INTERACTIVE_HOST=1` en su carpeta, y la mantiene viva, porque arrancar tarda más de un minuto (D51). El anfitrión escucha en un pipe con nombre, `\\.\pipe\sala-<sala>-<etiqueta>-<miembro>` en Windows o `.sala/host-<miembro>.sock` en Linux y Mac. La etiqueta sale de la carpeta de la sala, así dos salas con el mismo nombre no comparten pipe.

- **Reusa y no duplica.** Si el miembro ya está hospedado, devuelve el mismo anfitrión. Si tiene una sesión viva en el feed, no abre otra.
- **La sala le habla por el pipe.** `sala enviar` le da la orden si no está trabajando y no tiene una pregunta abierta. `sala preguntas` muestra sus diálogos con `session: "rpc"`. `sala responder` contesta cualquiera: una opción de un `select`, `sí` o `no` en un `confirm`, o un texto en un `input` o un `editor`. Así se contesta desde la sala una pregunta de varias partes, una parte por vez.
- **Las guardas están en el anfitrión**, no en la CLI: la pausa, una orden ilegible, una respuesta que no es una opción y una acción desconocida se niegan aunque alguien le hable al pipe directo. Cada pedido queda en `.sala/ordenes.log` con `via: "rpc"`, con los secretos enmascarados.
- **Un consentimiento lo retiene.** Todo diálogo cuyas palabras dicen `granted`, `declined` o `consent` es un consentimiento: el anfitrión nunca lo contesta. Lo da la persona con `sala consentir` en una terminal real (D48, SK7c).

`--cerrar` cierra la sesión hospedada si está libre y sin preguntas: cierra su stdin y espera a que salga. `--primer-plano` corre el anfitrión en la terminal actual, hasta que la sesión termine.

## `sala veredicto`

```
sala veredicto <miembro> <comando> [--texto] [--sala <carpeta>]
```

Después de mandar un comando, `sala veredicto` comprueba en JSON que haya dejado hecho lo que debía. Las reglas son fijas y están en el kit, no en el prompt (D16). Solo lee: nunca cambia el miembro.

| Comando | Regla | Qué comprueba |
|---|---|---|
| `miembro-entregar` (y, de puente, `flow-ship` y `flow-pr`) | `entrega` | está en una rama que no es la base, el árbol está limpio, el último commit está en el remoto, hay un PR abierto de esa rama, su CI está en verde (o no tiene) y la fila de la tarea cuyo ID cierra el título del PR dice `Completada` en el roadmap del último commit (D45) |
| `miembro-base` (y, de puente, `flow-base`) | `base` | está en la base, el árbol está limpio, no hay stash y la base es igual a la del remoto |

El comando va con o sin `/`, y lo que sigue al primer espacio no cuenta: `/flow-ship SK2d` es `flow-ship`. Como solo lee, también reconoce el comando cuando Git Bash lo convirtió en ruta (`C:/Program Files/Git/flow-ship`), sin hacer falta `MSYS_NO_PATHCONV=1`. Los nombres de las reglas (`entrega` y `base`) también sirven como comando. Los `/flow-*` son un puente: los miembros los usan hasta que la fase 5 los cambia por los `/miembro-*` (D26), y ahí se quitan. Cada comprobación sale con su `id`, si pasó y el motivo; `ok` es `true` solo si pasan todas. Después de una entrega, el JSON trae también la rama, el commit, el PR con su CI y el ID de la tarea.

## `sala fusionar`

```
sala fusionar <miembro> <n> [--texto] [--sala <carpeta>]
```

Fusiona el PR #n del miembro y sigue con su tarea siguiente, en una sola cadena (D18). Que la persona nombre el PR es el OK (D19): la sala nunca fusiona por su cuenta. Los pasos, en orden:

| Paso | Qué hace |
|---|---|
| `pr` | El PR está abierto, no es un borrador, va a la base del miembro, todos sus checks terminaron en verde (`SUCCESS`, `NEUTRAL` o `SKIPPED`; un resultado que el kit no conoce no cuenta como verde) o no tiene CI, y GitHub dice que se puede fusionar |
| `session` | El miembro tiene una sola sesión viva que puede recibir órdenes, con las guardas de `sala enviar`. Sin ella no se fusiona: después no podría volver a la base |
| `merge` | Fusiona con el primer método que el repo permite (squash, rebase o merge), y solo si la cabeza del PR sigue siendo el commit que se comprobó (`--match-head-commit`). Después comprueba que el PR figure `MERGED`: con una cola de fusión, `gh` puede terminar bien con el PR todavía abierto, y la cadena no sigue |
| `base` | Le manda `/miembro-base` a la sesión del miembro y espera a que termine |
| `gate` | La puerta: `sala veredicto <miembro> base` tiene que dar OK |
| `restart` | Si hay una tarea para pedir y la sala abrió la terminal del miembro en Orca, la reinicia con `sala reiniciar`, así la tarea arranca con contexto limpio (D29). Si la terminal es de la persona (no la abrió la sala, o es una pestaña de Windows Terminal), no la toca y sigue la misma sesión. Si el reinicio se niega, la cadena se detiene antes de pedir nada |
| `next` | Le pide la tarea siguiente del plan de la sala, `/miembro-tarea <ID>`, salvo que su fila diga `Auto: no` en `Notas`. Un ID que no tiene forma de ID no se manda: una fila es un dato, no una orden |

Se detiene en el primer paso que falla y dice cuál (`stoppedAt`) y por qué; en ese caso sale con código 1. Antes de cada paso mira `.sala/PAUSA` y el tope de tiempo de la cadena (45 minutos). Cada paso deja una línea en `.sala/fusiones.log`, con los secretos enmascarados; si no se puede anotar, la cadena no sigue (y si el paso era la fusión, el error lo dice). gh corre sin shell y con los argumentos en una lista (D40).

## `sala reiniciar` y `sala modelo`

```
sala reiniciar <miembro> [--texto] [--sala <carpeta>]
sala modelo [--texto] [--sala <carpeta>]
```

`sala reiniciar` le da al miembro una sesión nueva, con contexto limpio (D29): cierra la terminal de Orca que abrió la sala (`orca terminal close --tab`), espera a que la sesión termine y abre otra como `sala abrir`, y anota el handle nuevo en `.sala/estado.json`. Solo cierra si se cumple todo esto; si no, se niega y dice por qué:

- la terminal la abrió la sala en Orca (su handle está en `.sala/estado.json`) y sigue abierta. Nunca cierra una terminal de la persona ni una pestaña de Windows Terminal, que no tiene handle;
- la sesión viva del miembro es una sola, y es la que abrió la sala;
- está libre: no trabaja, no espera a sus agentes o trabajos, y no tiene una pregunta abierta;
- la tarea está fusionada: `sala veredicto <miembro> base` da OK (la base, sin cambios, sin stash e igual al remoto);
- la sala no está en pausa (`.sala/PAUSA`).

La pausa y la sesión se vuelven a mirar justo antes de cerrar, con el candado de `sala abrir` tomado. Si Orca cierra la terminal y la sesión sigue viva, no abre otra; si entre el cierre y la apertura aparece otra sesión en el miembro, no la toma como suya ni le manda nada; y si no puede abrir la nueva, lo dice y pide `sala abrir`.

`sala modelo` le aplica a la sesión de la sala el perfil de `options.roomModel` con la acción `apply_profile` del feed, solo para esa sesión y sin tocar la configuración global (D28). La sesión de la sala es la única sesión viva en su carpeta que no es de un miembro. Si el perfil pide una confirmación (por ejemplo, porque sube el modo de permisos), la sala no la da: la persona lo aplica con `/gentle:profiles` en la terminal de la sala. La acción queda en `.sala/ordenes.log`.

## `sala plan`

```
sala plan [--texto] [--sala <carpeta>]
```

Por cada miembro lee su `docs/ROADMAP.md` (formato de Orquestación 1.0) de la rama base **remota**, después de un `git fetch`: cuenta lo fusionado, no el árbol de trabajo. Devuelve:

- `inProgress`: las filas `En curso`;
- `next`: la primera fila `Pendiente` cuyas dependencias están `Completada`, con cada dependencia resuelta;
- `blocked`: las filas `Bloqueada`, con su nota, y las `Pendiente` anteriores a `next` que esperan, con el motivo;
- `done` y `total`: las filas completadas y todas.

Una dependencia es una fila del mismo roadmap, una fila de otro miembro con su prefijo (`CORE-E09` busca la fila `E09`, o `CORE-E09`, en el roadmap del miembro con prefijo `CORE`) o, si no es ninguna de las dos, informativa: se muestra y no bloquea. Una dependencia con prefijo que no se encuentra sale como «sin resolver», nunca se adivina. Las dependencias de otro miembro **sí bloquean** en el plan de la sala. Los textos largos se cortan en 100 caracteres para que el plan de toda la sala quede en unos 2 KB.

Suma también `queue`, **la cola de la sala**: todas las tareas abiertas de todos los miembros en el orden en que la sala las ejecuta, agrupadas en olas que pueden correr en paralelo. Se calcula en cada pedido y nunca se guarda. Cada ola toma, por miembro, una sola tarea: la primera cuyas dependencias están `Completada` en la base remota o corrieron en una ola anterior. Dentro de un miembro van primero las tareas en vuelo, después las de `pinned` en el orden de la lista y después el orden de las filas; el orden de `members` ordena a los miembros dentro de cada ola.

- `waves`: las olas; cada tarea con `member`, `id`, `entrega` y `waitsFor` (lo que espera y todavía no está hecho). Una fila `En curso` lleva `status: "en curso"`; una con un PR abierto cuyo título termina con su ID entre paréntesis lleva `status: "en revisión"`. Las dos van en la primera ola de su miembro, y lo que las espera, después: lo que está en vuelo **no cuenta como hecho** hasta que su fila diga `Completada` en la base. Una tarea fijada lleva `pinned: true`;
- `waiting`: lo que no avanza, con el motivo: `Bloqueada` con su nota, una dependencia sin resolver, un ciclo de dependencias, la espera a una tarea que no puede avanzar o un miembro que no se pudo leer;
- `warnings`: solo si hay algo que avisar, por ejemplo que no se pudieron leer los PR de un miembro (sus tareas en revisión salen como pendientes) o que una tarea de `pinned` no está en su roadmap.

Las dependencias informativas tampoco frenan la cola. Una tarea que espera a la persona sin decirlo con una dependencia o con `Bloqueada` no se puede detectar: la cola no lee las notas.

```
Sala upen
core (1/4 completadas)
  en curso:  E02 Entrega E02
  siguiente: E04 Entrega E04
  espera:    E03 Entrega E03: espera a E02 (En curso)
Cola
  ola 1: core E02 [en curso] · brand B2
  ola 2: core E03 (espera a E02)
  ola 3: core E04 · brand B1 (espera a CORE-E03)
  espera: brand B3: Bloqueada: Falta el logo
```

## `sala revisar`

```
sala revisar [miembro] [--texto] [--sala <carpeta>]
```

Revisa el catálogo de requisitos en cada miembro, o solo en `miembro` (su `id`). Los archivos del miembro se leen de la rama base **remota**, después de un `git fetch`. Cada requisito sale como `{id, ok, detail, fix}`: `ok` es `true`, `false` o `null` (sin comprobar, porque falta lo que necesita), y `fix` es la orden para la sesión del miembro que lo pone en condiciones.

| Requisito | Qué pide |
|---|---|
| `base-remote` | La carpeta existe, tiene el remoto de `sala.json` y la rama base está en ese remoto |
| `roadmap-table` | `docs/ROADMAP.md` con la tabla de Orquestación 1.0 |
| `roadmap-header` | Las tres líneas de cabecera: `**Dónde está:**`, `**Qué sigue:**` y `**Qué lo bloquea:**` |
| `roadmap-states` | Cada `Estado` es `Pendiente`, `En curso`, `Completada` o `Bloqueada` |
| `agents-size` | `AGENTS.md` existe y pesa 16 KB o menos |
| `member-block` | `AGENTS.md` tiene el bloque del miembro, entre `<!-- sala-kit:miembro:inicio -->` y `<!-- sala-kit:miembro:fin -->` |
| `no-secrets` | `AGENTS.md` sin secretos; también se revisa el `sala.json` de la sala, en `salaJson` |

Un secreto (token de GitHub, clave `sk-`, clave de AWS, clave privada o URL con usuario y clave) se informa con su tipo, el archivo y la línea; **nunca** se muestra el texto encontrado. Un `miembro` que no está en `sala.json` es un error.

Cada miembro trae también `warnings`: avisos que no hacen fallar, como el bloque viejo `panel:entrega` de repo-panel, que sigue hasta la fase 5 (D26).

## Adoptar y soltar miembros

```
sala adoptar <carpeta> [--id <id>] [--prefijo <PREFIJO>] [--base <rama>] [--remoto <nombre>] [--texto] [--sala <carpeta>]
sala soltar <miembro> [--texto] [--sala <carpeta>]
sala condiciones <miembro> [--texto] [--sala <carpeta>]
sala unirse [--texto] [--sala <carpeta>]
```

- `sala adoptar` suma el repositorio a `members` de `sala.json`. Deduce cada dato que no le pasás:
  - el `id`, del nombre de la carpeta en minúsculas;
  - el `prefix`, del `id` en mayúsculas, sin guiones;
  - el `remote`, `origin`;
  - la `base`, de la rama por defecto del remoto (`origin/HEAD`, la que deja `git clone`).

  Se niega con una carpeta que no existe, que no es la raíz de un repositorio, que es una sala o que ya es miembro. También se niega si no puede deducir un dato o si el resultado no valida. En todos esos casos, `sala.json` queda como estaba. **Nunca escribe en el miembro:** solo avisa si le falta el bloque del miembro o si tiene `panel:entrega`.
- `sala soltar` saca al miembro de `sala.json`, junto con sus tareas de `pinned`, sin tocar su repositorio.
- `sala condiciones` revisa al miembro y le manda por `sala enviar`, con sus guardas y su registro, la orden de cumplir lo que falta: un requisito por línea con su orden. Si la base o el remoto fallan, no manda nada, porque eso se corrige en `sala.json`. Si cumple todo, tampoco.
- `sala unirse` corre **en el miembro**, en una tarea propia: pone el bloque del miembro (`templates/miembro/bloque.md`) en su `AGENTS.md`. Nunca pisa:
  - si `AGENTS.md` no existe, lo crea con el bloque;
  - si ya tiene el bloque, no lo toca;
  - si tiene reglas propias sin las marcas, deja el bloque en `AGENTS.md.sugerido` (D41).

## `sala actualizar`

`sala actualizar [--texto] [--sala <carpeta>]` lleva una sala a la versión instalada del kit (D27). Correlo después de mejorar el kit (`git pull` en sala-kit):

1. **Migra `sala.json`**: aplica las migraciones de su formato, si cambió el `schema`, y anota en `kit` la versión instalada. Una sala sin `kit` se toma como una sala vieja y se migra.
2. **Reescribe el bloque de la sala** en su `AGENTS.md`: solo el texto entre `<!-- sala-kit:sala:inicio -->` y `<!-- sala-kit:sala:fin -->`. Lo de afuera queda igual, byte por byte. Si `AGENTS.md` no tiene las marcas, queda igual, y el bloque nuevo va a `AGENTS.md.sugerido` (si ese archivo ya existe, no se pisa).
3. **Vuelve a revisar a los miembros**, como `sala revisar`, y por cada uno que no cumple propone la orden `sala condiciones <miembro>`. **No la manda:** la corrés vos, o la sala con tu OK.

Antes de escribir, lee y decide todo. **No escribe nada** si:
- `sala.json` no es JSON válido o no valida después de migrar;
- es de un kit más nuevo que el instalado (`kit` mayor o `schema` mayor);
- `kit` no es una versión (`1.2.3`): podría ser de un kit más nuevo;
- las marcas del bloque están rotas (una sola, repetidas o al revés).

Correrlo de nuevo no cambia nada. Los archivos se reemplazan con un renombre, primero `AGENTS.md` y después `sala.json`: si el primero falla, no cambia nada; si falla el segundo, el error lo dice y otra corrida lo termina. Los cambios de cada versión están en [`CHANGELOG.md`](CHANGELOG.md).

## El motor de entrega

`engine/` es una **copia byte por byte** del motor de `flow-commit` y `flow-pr` de [flow-skills](https://github.com/victorvelazquez/flow-skills) (D22): `scripts/flow-commit.mjs`, `scripts/flow-pr.mjs`, las cuatro `scripts/lib/flow-pr-*.mjs` que usa y sus pruebas en `test/`, con la misma estructura de carpetas. Reescribirlo sería riesgo puro sobre el historial de Git.

- `engine/source.json` anota de dónde viene: el repo, el commit, la versión de flow-skills y el SHA-256 de cada archivo.
- `test/engine.test.js` falla si un archivo de `engine/` cambió, falta o sobra, y corre las pruebas del propio motor.
- **No se edita a mano.** Para traer una versión nueva, se vuelve a copiar entera y se regenera `source.json` en el mismo cambio.

El formato de commits y PR de D23 lo revisa el kit antes de llamar al motor, en `src/formato.js`, sin tocar la copia:

- **El título del PR** se valida con la misma regla que el commit, la de `parseConventionalSubject` del motor: `tipo(ámbito)!: resultado`, con el ámbito opcional.
- **El título termina con el ID de la tarea** entre paréntesis: `docs(guide): document theme H (M2c)`. Si se sabe la tarea, el ID tiene que ser el suyo.
- **Pasar de 72 caracteres** es solo un aviso.
- **Con `options.jira` en `true`**, el título tiene que llevar una clave de Jira (`ABC-123`). Apagado no se pide.
- **`options.language`** (`en` por defecto, o `es`) elige el idioma de las secciones del PR: Summary, Changes, Validation, Risks y Out of scope, con «Not run» donde no se corrió una prueba.

### `sala motor` y los comandos del miembro

`sala motor commit|pr <argumentos>` corre el motor en la carpeta actual, sin shell: los argumentos le llegan tal cual, y su salida y su código de salida vuelven sin cambios. Hay una sola excepción, el paso que sella el PR (`sala motor pr --prepare --handle <h>`). Antes de llamarlo, el kit lee el título que quedó en el `intent.json` del motor y lo revisa con `src/formato.js`. Si no cumple, se niega y no llama al motor: el pedido queda y alcanza con corregir el título y repetir el paso. Con `--tarea <ID>`, el ID del título tiene que ser ese; con `--jira`, tiene que llevar una clave de Jira. Esos dos flags son del kit y solo valen en ese paso, donde se sacan antes de llamar al motor; en los demás pasos le llegan al motor, que los rechaza. Si el motor no arranca o termina por una señal, `sala motor` lo dice y sale con 1.

Los comandos del miembro se cargan con el kit y se niegan fuera de un miembro (`sala donde`):

- **`/miembro-tarea [ID]`** toma la tarea `ID` del roadmap, o la siguiente, comprueba que esté en su base limpia y al día y que la tarea esté lista, y la empieza; si falta algo, muestra un resumen y espera el OK. Nunca cambia de rama ni entrega.
- **`/miembro-entregar [ID]`** hace el commit y el PR de la tarea terminada con `sala motor`, sin `/flow-*` ni `git commit`, y comprueba el PR con `gh`. Nunca fusiona.
- **`/miembro-base`** vuelve a la rama base y la trae del remoto solo con avance rápido. Nunca borra ramas, ni guarda en el stash, ni fuerza nada.
- **`/miembro-informe`** cuenta el avance del proyecto entero: lo hecho, lo en curso, lo pendiente en orden y el paso siguiente. Solo lee.

El motor corre en la conversación del miembro, sin subagente: el kit todavía no instala agentes (SK5d). La sala manda estos comandos (`/sala-plan`, `/sala-seguir`, `/sala-entregar` y `sala fusionar`), nunca `/flow-*`. `sala veredicto` todavía acepta `flow-ship`, `flow-pr` y `flow-base` como puente, hasta SK5c.

## Documentos

- [`docs/DISENO.md`](docs/DISENO.md): todas las decisiones de diseño y lo que falta comprobar.
- [`docs/ROADMAP.md`](docs/ROADMAP.md): las fases como tareas.
- [`AGENTS.md`](AGENTS.md): las reglas para los agentes que trabajan en este repositorio.

## Requisitos

Node >= 20, sin dependencias. Para el adaptador de terminales: Orca y Gentle Shell (pi).
