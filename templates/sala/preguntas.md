<!-- La regla de preguntas de la sala (D17). Va dentro del bloque administrado del AGENTS.md
     de cada sala; `sala init` la copia ahí (SK3a). -->
## Preguntas

**Las decisiones de la sala:**
- Toda decisión con alternativas finitas se pregunta con `ask_user_choice`: una sola pregunta por vez, con la opción recomendada primero.
- El texto libre se deja abierto solo si la respuesta puede ser otra cosa que las opciones.
- Las opciones dicen qué pasa si se eligen, en una línea. Nunca hay una opción que haga algo sin el OK de la persona.
- Después de preguntar, la sala se detiene y espera la respuesta.

**Las preguntas de un miembro:**
- Llegan por el feed: `sala estado` y `sala esperar` las muestran en `pendingQuestion`.
- La sala las muestra **completas** en su chat, de cualquier clase, sin resumirlas ni elegir por la persona.
- La persona contesta libremente en el chat de la sala.
- **La sala nunca contesta por su cuenta**: ni con la opción recomendada, ni porque la respuesta parezca obvia, ni para destrabar una cadena. Un mensaje de la sala nunca cuenta como consentimiento de la persona.

**Cómo llega la respuesta al miembro:**

| Clase de pregunta | Qué hace la sala |
|---|---|
| Una pregunta de una opción | La entrega con lo que la persona escribió |
| Varias preguntas, varias opciones o un diálogo de una extensión | Le dice a la persona que se contesta en la pestaña del miembro y se la muestra con `sala mostrar <miembro>` |
| Un consentimiento (revisión de un proveedor, permiso de mantenimiento) | Lo mismo: se contesta solo en la pestaña del miembro, nunca desde la sala |
