# sala-kit

El motor reutilizable de una **sala**: una sesión de Gentle Shell que coordina varios repositorios (los **miembros**) mientras una persona decide.

> Estado: **fase 2**. La CLI `sala` tiene `sala estado`, `sala plan`, `sala revisar`, `sala abrir` y `sala mostrar`.

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
| `kit` | La versión del kit con la que se escribió |
| `name` | El nombre de la sala |
| `members[].id` | Minúsculas, dígitos y guiones, sin repetir. Es como se nombra al miembro en todos los comandos |
| `members[].prefix` | Mayúsculas y dígitos, sin repetir: el prefijo de los IDs de su roadmap (`CORE-E09`) |
| `members[].path` | Ruta absoluta a la raíz del repo |
| `members[].base` | La rama base: letras, dígitos, `.`, `_`, `-` y `/`, sin empezar con `-` |
| `members[].remote` | Opcional, `origin` por defecto. Es el nombre de un remoto del repo, nunca una URL (una URL puede llevar credenciales) |
| `pinned` | Opcional: las tareas que la persona pone adelante en la cola, con el prefijo del miembro (`CORE-E09`), sin repetir y en orden de prioridad. Es intención de la persona, no estado |
| `options` | Opcional: `language`, `jira` (`true` o `false`), `transport`, `launcher` (`auto`, el valor por defecto, `orca` o `wt`; ver `sala abrir`) y `roomModel` (texto o `null`) |

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

- la sala no está en pausa: si existe `.sala/PAUSA`, no manda nada (los comandos para pausar y seguir llegan con SK2e, D38);
- el miembro está en `sala.json` y tiene **una sola** sesión viva, que es suya (con dos, se niega y dice sus IDs);
- esa sesión no tiene una pregunta abierta ni está bloqueada;
- la orden se puede leer: no está vacía (tampoco hecha solo de caracteres invisibles), no pasa de 4000 caracteres y no tiene caracteres de control ni de dirección (D39). Tampoco puede empezar con `-`.

Gentle Shell suma sus propias guardas: niega los comandos que solo corren en la terminal (`/new`, `/quit`, `/gentle:*`, las líneas `!`), y su respuesta sale en el error. Un mensaje de la sala nunca cuenta como consentimiento de la persona. Cada orden queda en `.sala/ordenes.log`, una línea JSON con la hora, el miembro, la sesión, la orden (con cualquier secreto enmascarado) y el resultado: `refused` si la negó una guarda del kit; `sending` antes de dejarla en la bandeja y, después, `sent` o el código con que la negó Gentle Shell. Si la línea `sending` no se puede escribir, la orden no se manda.

Git Bash convierte `/flow-avance` en una ruta (`C:/Program Files/Git/flow-avance`) antes de que la CLI la vea. `sala enviar` reconoce esa ruta y se niega; desde Git Bash, corré `MSYS_NO_PATHCONV=1 sala enviar core /flow-avance`.

`sala esperar` vigila el estado de la sesión en el feed y termina cuando el miembro termina **de verdad**: `idle` durante 3 s seguidos, para no confundir el momento antes de que arranque una orden recién mandada. Mientras dice `waiting` (le quedan subagentes o trabajos) sigue esperando (D15). Termina enseguida, con `state: "needs-you"` y la pregunta, si el miembro te necesita. Falla si la sesión se cierra o si pasan 30 minutos. Está pensada para que la sala la corra como trabajo en segundo plano y duerma sin gastar tokens hasta que termine.

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
| `no-secrets` | `AGENTS.md` sin secretos; también se revisa el `sala.json` de la sala, en `salaJson` |

Un secreto (token de GitHub, clave `sk-`, clave de AWS, clave privada o URL con usuario y clave) se informa con su tipo, el archivo y la línea; **nunca** se muestra el texto encontrado. Un `miembro` que no está en `sala.json` es un error.

## Documentos

- [`docs/DISENO.md`](docs/DISENO.md): todas las decisiones de diseño y lo que falta comprobar.
- [`docs/ROADMAP.md`](docs/ROADMAP.md): las fases como tareas.
- [`AGENTS.md`](AGENTS.md): las reglas para los agentes que trabajan en este repositorio.

## Requisitos

Node >= 20, sin dependencias. Para el adaptador de terminales: Orca y Gentle Shell (pi).
