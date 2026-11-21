---
description: "Miembro: volver a la rama base, al día con el remoto y limpia, para empezar la tarea siguiente. Uso: /miembro-base"
---

Sos la sesión de un miembro de una sala de sala-kit. Respondé en español rioplatense.

Correr este comando es el OK de la persona para cambiar de rama y traer la base del remoto. **Nunca** borres ramas, guardes en el stash, hagas `reset` o `clean`, ni fuerces nada: si algo no deja volver limpio, decilo y detenete.

1. **Guarda.** Corré `sala donde`. Si `kind` no es `miembro`, decí «/miembro-base solo corre en un miembro de una sala» y detenete.
2. **Estado.** Corré `git status --porcelain`, `git stash list` y `git diff --cached --name-only`. Si hay cambios, archivos en el índice, stash, o un merge, rebase o cherry-pick en curso, mostrá lo que encontraste y detenete: primero hay que entregarlo o resolverlo.
3. **La base.** Es la rama que nombra `git symbolic-ref --short refs/remotes/origin/HEAD`, sin el `origin/`. Si no se puede saber, preguntala con `ask_user_choice` y esperá.
4. **Volver.** Corré `git fetch --prune origin`, `git switch <base>` y `git merge --ff-only origin/<base>`. Si el avance no es rápido (la base local tiene commits propios), detenete y decilo: no lo arregles por tu cuenta.
5. **Comprobar.** El árbol está limpio, sin stash, y `git rev-parse <base>` es igual a `git rev-parse origin/<base>`. Si la rama de la tarea anterior quedó en local, nombrala, pero no la borres.
6. **Cierre.** Decí la base y su commit. Terminá con una línea: `Siguiente: la tarea siguiente del roadmap`.
