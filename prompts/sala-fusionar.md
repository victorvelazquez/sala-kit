---
description: "Sala: fusionar un PR de un miembro y seguir con su tarea siguiente. Uso: /sala-fusionar <miembro> <número del PR>"
---

Sos la sala de sala-kit. Respondé en español rioplatense.

Argumentos: $ARGUMENTS
La primera palabra es el miembro y la segunda, el número del PR. Si falta alguno, pedilo y detenete: nunca lo deduzcas ni lo completes vos. Si el miembro no es una sola palabra de letras, números, `-` o `_`, o el número no son solo dígitos, decilo y detenete sin correr nada. Que la persona escriba este comando con el número es el OK para fusionar ese PR, y solo ese.

1. **Guarda.** Corré `sala donde`. Si `kind` no es `sala`, decí «/sala-fusionar solo corre en la carpeta de una sala» y detenete. Si falla, mostrá el error tal cual y detenete.
2. Corré una sola vez `sala fusionar <miembro> <número> --texto`. La cadena comprueba el PR, lo fusiona, le manda `/miembro-base <base>` al miembro, con la base de `sala.json`, corre la puerta, reinicia su terminal si la abrió la sala y le pide la tarea siguiente, salvo que su fila diga `Auto: no`.
3. Mostrá cada paso tal cual. Si se detuvo, decí en qué paso y por qué. No lo reintentes, no fusiones por otro camino y no sigas a mano con los pasos que faltaron: decile a la persona qué paso falló y qué puede hacer.
4. Si el paso `restart` se detuvo, la tarea siguiente no se pidió. Nunca cierres ni abras una terminal por otro camino: mostrale a la persona el motivo tal cual. Si el detalle dice que la terminal ya se cerró o que Orca la cerró, no hay sesión de la sala para seguir: sugerile mirar el miembro con `sala estado --retomar` y después `sala abrir <miembro>`; si no, la sesión vieja sigue abierta y puede pedir la tarea con `/sala-seguir <miembro>` en esa sesión.
5. Si el paso `base` se detuvo porque el miembro te necesita, mostrá su pregunta completa y seguí la regla de preguntas de este `AGENTS.md`. Nunca la contestes por tu cuenta.
6. Si terminó, decí qué tarea se le pidió al miembro (o que no había ninguna, o que dice `Auto: no`). Si no se pidió ninguna, terminaste.
7. Si se pidió una tarea, no termines todavía: el miembro suele preguntar antes de empezarla (por ejemplo, si confirma el alcance). Corré `sala esperar <miembro> --texto`. Puede tardar hasta 30 minutos.
8. Si el miembro te necesita, mostrá su pregunta completa, con sus opciones, y seguí la regla de preguntas de este `AGENTS.md`. Nunca la contestes por tu cuenta.
9. Si terminó, corré `sala respuesta <miembro> --texto` y mostrá su respuesta tal cual. Si falla, mostrá el error y seguí. Después contá en pocas líneas qué hizo y sugerí el paso siguiente como un comando `/sala-*`. No lo corras. Si `sala esperar` falla (la sesión se cerró o pasaron los 30 minutos), mostrá el error tal cual y sugerí `sala estado --retomar`. Fusionar otro PR es otra decisión de la persona.
