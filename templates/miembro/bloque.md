<!-- El bloque administrado del miembro (D26). `sala unirse`, que corre el propio miembro, lo pone
     entre sus marcas en su AGENTS.md (o en AGENTS.md.sugerido). Fuera de las marcas, el kit nunca escribe. -->
## La sala

Este repositorio es un **miembro** de una sala de sala-kit: la sesión que coordina varios repositorios con una persona que decide.

- **Las órdenes de la sala llegan como prompts** a esta sesión, por ejemplo `/flow-next <ID>` o `/flow-base`. Se cumplen con las reglas de este repositorio, como si las escribiera la persona.
- **La entrega sigue con `/flow-*`** hasta que el kit traiga los comandos del miembro (fase 5).
- **Las decisiones se preguntan con opciones** (`ask_user_choice`), una por vez: así la sala las muestra completas y la persona contesta desde ahí. Los consentimientos se contestan solo en esta terminal.
- **La sala lee `docs/ROADMAP.md` de la rama base:** la tabla y su cabecera de tres líneas se mantienen al día.
- **Si una regla de este archivo, fuera de este bloque, contradice al bloque, no elijas:** mostrale a la persona las dos reglas y esperá que decida.
