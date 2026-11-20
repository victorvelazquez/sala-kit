# sala-kit

El motor reutilizable de una **sala**: una sesión de Gentle Shell que coordina varios repositorios (los **miembros**) mientras una persona decide.

> Estado: **fase 1**. La CLI `sala` tiene `sala estado`, `sala plan` y `sala revisar`.

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
| `options` | Opcional: `language`, `jira` (`true` o `false`), `transport` y `roomModel` (texto o `null`) |

Un campo desconocido es un error, para que una errata no pase callada.

## `sala estado`

```
sala estado [--texto] [--sala <carpeta>]
```

Por cada miembro, en paralelo: la rama, el árbol, el stash, si la base local es igual a la del remoto (después de un `git fetch`), los PR abiertos con su CI (`passing`, `failing`, `pending` o `none`) y la **puerta** con cada motivo por el que no está lista. Sale en JSON compacto (`{"schema":1,"sala":...,"members":[...]}`), que es un contrato: cambia con `schema`. Con `--texto`, una línea por miembro:

```
Sala upen
core   LISTO     develop
brand  NO LISTO  feat: está en la rama feat, no en la base develop
```

Un miembro que falla (la carpeta no existe, el `fetch` no llega, `gh` no tiene sesión) no frena a los demás: queda como motivo. Git y `gh` corren sin shell y sin pedir credenciales, y las credenciales de una URL o un token nunca salen en la salida.

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
