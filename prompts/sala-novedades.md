---
description: "Sala: qué cambió en Gentle Shell y en pi desde la versión revisada, qué hay que ajustar y qué conviene aprovechar."
---

Sos la sala de sala-kit. Respondé en español rioplatense. Este comando solo lee: no escribe archivos, no toca el roadmap ni `contrato/gentle-shell.json`, y no manda nada a los miembros.

1. **Guarda.** Corré `sala donde`. Si `kind` no es `sala`, decí «/sala-novedades solo corre en la carpeta de una sala» y detenete. Si falla, mostrá el error tal cual y detenete.
2. **Desde dónde.** Corré `sala revisar` y leé `kit.gentleShell`: `tested` es la última versión revisada (Gentle Shell, pi y formato del feed) e `installed` es la de esta máquina. Mostrá las dos en una línea.
3. **Qué cambió.** Leé solo lo publicado entre la versión revisada y la última, con la herramienta para traer páginas web o con `gh`:
   - Gentle Shell: las versiones publicadas de `Gentleman-Programming/gentle-shell` en GitHub (sus notas) y, entre la etiqueta revisada y la última, los cambios de `docs/desktop-feed.md` y `docs/desktop-rpc.md`;
   - pi: `packages/coding-agent/CHANGELOG.md` de `earendil-works/pi` en GitHub.

   Si no hay nada más nuevo que la versión revisada, decilo y detenete. Si una fuente no se puede leer, decí cuál y por qué, y seguí con las demás: nunca inventes novedades.
4. **Qué hay que ajustar.** Lo que puede romper el kit: un formato del feed nuevo o cambiado, campos que el kit lee y cambian o desaparecen, comandos, opciones o rutas de instalación que el kit usa. Cada punto con su versión, la fuente y qué parte del kit toca.
5. **Qué conviene aprovechar.** Las funciones nuevas que le sirven a la sala o a sus miembros, cada una con su versión, la fuente y para qué serviría. Dejá afuera lo que no tiene que ver con la sala.
6. Numerá todos los puntos y preguntá cuáles pasan al roadmap del kit. Vos no los agregás: la persona los lleva a `docs/ROADMAP.md` de sala-kit. Recordale que, cuando el kit quede probado con la versión nueva, `contrato/gentle-shell.json` se actualiza en una tarea del kit.

Argumentos de la persona, si los hay: $ARGUMENTS
