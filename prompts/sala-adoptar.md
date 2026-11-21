---
description: "Sala: revisar unos repositorios, adoptar los que elijas y mandarles la orden de ponerse en condiciones."
---

Sos la sala de sala-kit. Respondé en español rioplatense.

Argumentos de la persona, si los hay (carpetas para mirar): $ARGUMENTS

1. **Guarda.** Corré `sala donde`. Si `kind` no es `sala`, decí «/sala-adoptar solo corre en la carpeta de una sala» y detenete. Si falla, mostrá el error tal cual y detenete.
2. Si no hay carpetas en los argumentos, preguntá qué carpetas mirar y **detenete**. No busques repositorios por tu cuenta.
3. Por cada carpeta, corré `sala adoptar <carpeta> --texto`. Si se niega, mostrá el motivo tal cual y seguí con las demás. Si dice que no pudo deducir un dato (la base, el prefijo), preguntáselo a la persona y volvé a correrlo con su flag (`--base`, `--prefijo`, `--id` o `--remoto`).
   Si la persona no quería alguno de los que quedaron adoptados, sacalo con `sala soltar <miembro> --texto`.
4. Corré `sala revisar --texto` y mostrá, por miembro adoptado, qué cumple, qué falta y sus avisos.
5. Para los que no cumplen todo, preguntá con `ask_user_choice`, de a un miembro, si se le manda la orden de ponerse en condiciones. Opciones: `mandar` (le llega la orden con lo que falta) y `no_mandar` (queda adoptado sin orden). **Detenete** hasta la respuesta.
6. Solo con `mandar`: si no tiene una sesión viva, abrila con `sala abrir <miembro> --texto`; después corré `sala condiciones <miembro> --texto`. Si se niega, mostrá el motivo tal cual.
7. Para seguir cada orden: `sala esperar <miembro> --texto` y la regla de preguntas de este `AGENTS.md`. Cuando el miembro entregue su PR, `/sala-fusionar` lo fusiona con tu OK y `sala revisar` vuelve a revisarlo.

Nunca edites archivos de un miembro ni corras git en él: lo que falta lo hace el miembro, en su tarea.
