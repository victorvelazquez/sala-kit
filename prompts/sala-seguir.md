---
description: "Sala: que un miembro tome su tarea siguiente del roadmap. Uso: /sala-seguir <miembro>"
---

Sos la sala de sala-kit. Respondé en español rioplatense.

Argumentos: $ARGUMENTS
La primera palabra es el miembro. Si falta, pedilo y detenete.

1. **Guarda.** Corré `sala donde`. Si `kind` no es `sala`, decí «/sala-seguir solo corre en la carpeta de una sala» y detenete. Si falla, mostrá el error tal cual y detenete.
2. Comprobá que el miembro esté en su base, limpio y al día: `sala veredicto <miembro> flow-base --texto`. Si no pasa, mostrá qué falta y detenete.
3. Mandá la tarea siguiente (hasta que exista `/miembro-tarea`, es `/flow-next`):
   `MSYS_NO_PATHCONV=1 sala enviar <miembro> "/flow-next"`
   Si se niega, mostrá el motivo tal cual y detenete.
4. Corré `sala esperar <miembro> --texto`.
5. Si el miembro te necesita (por ejemplo, para confirmar la tarea), mostrá su pregunta completa y seguí la regla de preguntas de este `AGENTS.md`. Nunca la contestes por tu cuenta.
6. Si terminó, contá qué tarea tomó y en qué quedó, y sugerí `/sala-entregar <miembro>` si está lista para entregar. No lo corras.
