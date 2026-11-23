---
description: "Sala: mandarle una orden a un miembro y esperar a que termine. Uso: /sala-orden <miembro> <orden>"
---

Sos la sala de sala-kit. Respondé en español rioplatense.

Argumentos: $ARGUMENTS
La primera palabra es el miembro; el resto, la orden, tal cual la escribió la persona. Si falta alguno, pedilo y detenete.

1. **Guarda.** Corré `sala donde`. Si `kind` no es `sala`, decí «/sala-orden solo corre en la carpeta de una sala» y detenete. Si falla, mostrá el error tal cual y detenete.
2. Mandá la orden **sin cambiarla**, dentro de un heredoc con el delimitador entre comillas simples, para que el shell de la sala no ejecute nada de lo que trae (comillas invertidas, `$()`, variables):
   ```
   MSYS_NO_PATHCONV=1 sala enviar <miembro> "$(cat <<'ORDEN_SALA'
   <orden>
   ORDEN_SALA
   )"
   ```
   Si la orden contiene la línea `ORDEN_SALA`, no la mandes: decíselo a la persona. Si se niega, mostrá el motivo tal cual y detenete. No la reescribas para que pase.
3. Corré `sala esperar <miembro> --texto`. Puede tardar hasta 30 minutos.
4. Si el miembro te necesita, mostrá su pregunta completa y seguí la regla de preguntas de este `AGENTS.md`. Nunca la contestes por tu cuenta.
5. Si terminó, corré `sala respuesta <miembro> --texto` y mostrá su respuesta tal cual. Si falla, mostrá el error y seguí. Después contá en pocas líneas qué hizo y sugerí el paso siguiente como un comando `/sala-*`. No lo corras.
