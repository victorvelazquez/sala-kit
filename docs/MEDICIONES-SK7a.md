# Mediciones de SK7a: el transporte por RPC de pi

Hechas el 2026-11-21 con Gentle Shell 4.9.0 (pi 1.5.2), en Windows 11, sobre una carpeta temporal y una sesión de sesiones propia (`--session-dir`). Sin código del kit: un script de medición fuera del repositorio.

## Cómo se lanzó

```
node <gentle-shell>/versions/<actual>/node_modules/gentle-pi/bin/gentle-shell.mjs --mode rpc --session-dir <tmp>/sessions
```

con `GENTLE_SHELL_INTERACTIVE_HOST=1` en el entorno y la carpeta del miembro como `cwd`. `gentle-shell.cmd` hace lo mismo con el Node que trae Gentle Shell; desde Node conviene lanzar ese Node y el `.mjs` directo, sin pasar por `cmd`.

## Lo medido

| Pregunta | Resultado |
|---|---|
| ¿Arranca `gentle-shell --mode rpc`? | Sí. Tardó **unos 73 s** en dar señales y 86 s en contestar `get_state`: el arranque en frío carga perfil, agentes y registro de skills. El anfitrión no puede lanzar una sesión por orden. |
| ¿Qué modelo usa? | El del perfil (`claude-opus-5-5` en esta máquina). Una sesión hospedada gasta como una de terminal. |
| ¿Para qué sirve `GENTLE_SHELL_INTERACTIVE_HOST=1`? | Es la señal de la app de escritorio (`lib/rpc-host.ts`). Sin ella, `ask_user_choice` y `ask_user_question` dan error en RPC; con ella, se vuelven diálogos de pi. Gentle Shell la borra en los subagentes. |
| ¿Cómo llega `ask_user_question` de dos preguntas? | Como **un `select` por pregunta**, uno detrás del otro, con las opciones y `Type something.` al final. Contestar con `extension_ui_response` (`value`) funcionó: la herramienta devolvió `1. … — A` y `2. … — A`. Una opción de texto libre abre después un `input`. |
| ¿Y `ask_user_choice`? | Por código: un `select` con las etiquetas, y `Type your answer` si se permite texto libre, seguido de un `input`. |
| ¿Y un consentimiento de revisión? | Por código (`lib/review-consent-ui.ts`), no se midió en vivo: fuera de la TUI es un `select` cuyo título trae el `headline`, `Reason`, `Risk` y `Ownership`, y tres opciones (`1. … granted`, `2. … declined`, `3.` el permiso de la sesión). El kit lo reconoce por ese título y esas opciones, no por un campo propio. |
| ¿Cuánto llega por stdout? | 46 `extension_ui_request` en un turno, casi todos `setWidget`, `setStatus` y `notify` que no esperan respuesta. Solo `select`, `confirm`, `input` y `editor` se contestan. |
| ¿Cómo se cierra? | Al cerrar stdin, la sesión salió con código 0 a los 10 s. |
| ¿Se distingue en el archivo de sesión un mensaje de la persona? | **No.** Una entrada de usuario tiene `type, id, parentId, timestamp, message`, y el mensaje `role, content, timestamp`. El origen (`interactive`, `rpc` o `extension`) solo lo ve el evento `input`, en memoria. Gentle Shell guarda la palabra de la persona solo como un ancla de idioma de 100 caracteres, y no siempre. |
| ¿Las herramientas del agente pueden escribir el archivo de sesión? | **Sí.** La guarda de Gentle Shell cubre solo `<agentDir>/desktop/` (`extensions/gentle-ai.ts`). Un modelo manipulado puede escribirse un «mensaje de la persona» en su sesión. |
| ¿Publica su snapshot en el feed? | Sí, según D46: lo medido el 2026-11-20 incluía sesiones en modo `rpc`. No se repitió para no leer `desktop/` (D50). |

## Qué cambia

- **D48 no se puede cumplir tal como está escrita.** Comprobar «el último mensaje escrito por la persona en la sala» leyendo la sesión de la sala no es mecánico: el archivo no dice quién escribió cada mensaje y el agente lo puede escribir. Hace falta una decisión de la persona antes de SK7c.
- **El anfitrión es el que tiene las guardas.** La CLI la corre el modelo de la sala, así que cualquier canal entre `sala` y el anfitrión es tan fuerte como el código que lo atiende. Lo que se niega (un consentimiento sin la comprobación, una acción fuera de la lista) se niega dentro del anfitrión.
- **Una sesión hospedada se abre una vez y se mantiene.** Con más de un minuto de arranque, `sala hospedar` deja la sesión viva y `sala estado` la mira por el feed como a las demás.
