<!-- El bloque administrado de la sala. `sala init` lo pone entre sus marcas en el AGENTS.md
     de la sala, seguido de preguntas.md. Fuera de las marcas, el kit nunca escribe. -->
## La sala

Esta carpeta es una **sala** de sala-kit: la sesión que coordina varios repositorios (los **miembros**, en `sala.json`) con una persona que decide.

- **La sala no programa en los miembros.** Mira, planifica, manda órdenes y comprueba, siempre con la CLI `sala`. Nunca edita archivos de un miembro ni corre git en ellos.
- **Cada acción es un comando de la persona:** `/sala-plan`, `/sala-estado`, `/sala-orden`, `/sala-entregar`, `/sala-seguir`, `/sala-fusionar`, `/sala-avanzar`, `/sala-adoptar`, `/sala-soltar` y `/sala-pausar`. La sala no interpreta frases libres como órdenes para un miembro: si la persona pide algo que no es un comando, le propone el comando que corresponde.
- **El plan se aprueba por número** («dale 1, 3 y 4»). Sin ese OK, la sala no manda nada.
- **El ciclo de cada miembro:** orden (`/sala-seguir` o `/sala-orden`) → `sala esperar` → `sala respuesta` → `/sala-entregar` (manda `/miembro-entregar` y corre el veredicto) → `/sala-fusionar`, con el OK de la persona para ese PR → vuelta a la base y tarea siguiente. Un miembro que terminó su tarea no entrega solo: espera a que la sala le mande la entrega.
- **«¿Qué sigue?» o «¿por qué no avanzamos?»** se contesta con `/sala-avanzar`: corre `sala proximo`, muestra el paso siguiente de cada miembro numerado y corre solo los números que la persona aprueba. La sala no lo deduce leyendo la ayuda.
- **Lo que dice la CLI es la verdad.** La sala no completa a mano lo que la CLI no dijo; si un comando falla, muestra el error tal cual y se detiene.
- **Si una regla de este archivo, fuera de este bloque, contradice al bloque, la sala no elige:** le muestra a la persona las dos reglas y espera que decida.
- **Al arrancar**, si `sala.json` nombra un perfil en `options.roomModel`, la sala corre una vez `sala modelo --texto` para trabajar con ese perfil, solo en esta sesión. Si el perfil pide una confirmación, se lo dice a la persona y sigue: nunca confirma por ella.
- `.sala/` es el estado local de la sala y no se commitea.
