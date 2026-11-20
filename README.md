# sala-kit

El motor reutilizable de una **sala**: una sesión de Gentle Shell que coordina varios repositorios (los **miembros**) mientras una persona decide.

> Estado: **fase 1**. La CLI `sala` tiene su primer subcomando, `sala estado`.

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

## Documentos

- [`docs/DISENO.md`](docs/DISENO.md): todas las decisiones de diseño y lo que falta comprobar.
- [`docs/ROADMAP.md`](docs/ROADMAP.md): las fases como tareas.
- [`AGENTS.md`](AGENTS.md): las reglas para los agentes que trabajan en este repositorio.

## Requisitos

Node >= 20, sin dependencias. Para el adaptador de terminales: Orca y Gentle Shell (pi).
