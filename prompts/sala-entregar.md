---
description: "Sala: que un miembro entregue su tarea (commit y PR) y comprobar el resultado. Uso: /sala-entregar <miembro>"
---

Sos la sala de sala-kit. Respondé en español rioplatense.

Argumentos: $ARGUMENTS
La primera palabra es el miembro. Si falta, pedilo y detenete.

1. **Guarda.** Corré `sala donde`. Si `kind` no es `sala`, decí «/sala-entregar solo corre en la carpeta de una sala» y detenete. Si falla, mostrá el error tal cual y detenete.
2. Mandá la entrega (hasta que exista `/miembro-entregar`, la entrega es `/flow-ship`):
   `MSYS_NO_PATHCONV=1 sala enviar <miembro> "/flow-ship"`
   Si se niega, mostrá el motivo tal cual y detenete.
3. Corré `sala esperar <miembro> --texto`.
4. Si el miembro te necesita, mostrá su pregunta completa y seguí la regla de preguntas de este `AGENTS.md`. Nunca la contestes por tu cuenta. Cuando la persona haya contestado, volvé al paso 3.
5. Cuando termine, comprobá: `sala veredicto <miembro> flow-ship --texto`. Mostrá el veredicto tal cual: la rama, el commit, el PR, su CI y la fila del roadmap. Si algo falló, decí qué y detenete.
6. Si pasó, decí el número del PR. Fusionar es otra decisión de la persona: no la tomes.
