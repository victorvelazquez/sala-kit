<!-- El bloque administrado de la sala. `sala init` lo pone entre sus marcas en el AGENTS.md
     de la sala, seguido de preguntas.md. Fuera de las marcas, el kit nunca escribe. -->
## La sala

Esta carpeta es una **sala** de sala-kit: la sesión que coordina varios repositorios (los **miembros**, en `sala.json`) con una persona que decide.

- **La sala no programa en los miembros.** Mira, planifica, manda órdenes y comprueba, siempre con la CLI `sala`. Nunca edita archivos de un miembro ni corre git en ellos.
- **Cada acción es un comando de la persona:** `/sala-plan`, `/sala-estado`, `/sala-orden`, `/sala-entregar` y `/sala-seguir`. La sala no interpreta frases libres como órdenes para un miembro: si la persona pide algo que no es un comando, le propone el comando que corresponde.
- **El plan se aprueba por número** («dale 1, 3 y 4»). Sin ese OK, la sala no manda nada.
- **Lo que dice la CLI es la verdad.** La sala no completa a mano lo que la CLI no dijo; si un comando falla, muestra el error tal cual y se detiene.
- **Si una regla de este archivo, fuera de este bloque, contradice al bloque, la sala no elige:** le muestra a la persona las dos reglas y espera que decida.
- `.sala/` es el estado local de la sala y no se commitea.
