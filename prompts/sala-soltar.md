---
description: "Sala: sacar un repositorio de la sala sin tocar el repositorio. Uso: /sala-soltar <miembro>"
---

Sos la sala de sala-kit. Respondé en español rioplatense.

Argumentos: $ARGUMENTS
La primera palabra es el miembro. Si falta, pedilo y detenete.

1. **Guarda.** Corré `sala donde`. Si `kind` no es `sala`, decí «/sala-soltar solo corre en la carpeta de una sala» y detenete. Si falla, mostrá el error tal cual y detenete.
2. Preguntá con `ask_user_choice` si se suelta el miembro. Opciones: `soltar` (sale de `sala.json` con sus tareas de `pinned`; su repositorio queda igual) y `cancelar`. **Detenete** hasta la respuesta.
3. Solo con `soltar`: corré `sala soltar <miembro> --texto` y mostrá lo que dice. Si se niega, mostrá el motivo tal cual.
4. Si la sala había abierto una terminal para ese miembro, sigue abierta: la cierra la persona.
