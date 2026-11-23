# Cambios de sala-kit

Cada versión dice qué cambió para las salas que ya existen. Después de actualizar el kit, corré `sala actualizar` en cada sala: anota la versión en `kit` de `sala.json`, migra su formato si cambió y reescribe el bloque de la sala en su `AGENTS.md`.

## 0.1.0 (sin publicar)

La primera versión. `sala.json` tiene `schema: 1`.

- **La CLI `sala`.** Cubre:
  - crear y mirar la sala: `init`, `donde`, `estado`, `plan` y `revisar`;
  - programar el plan del día: `agendar`, que imprime la tarea de Windows y nunca la instala;
  - las sesiones de los miembros: `abrir`, `mostrar`, `enviar`, `esperar`, `respuesta`, `preguntas` y `responder`;
  - juzgar y fusionar: `veredicto`, `fusionar`, `reiniciar` y `modelo`;
  - los miembros: `adoptar`, `soltar`, `unirse` y `condiciones`;
  - poner la sala al día: `actualizar`;
  - frenar las órdenes: `pausar` y `seguir`.
- **Los comandos de Gentle Shell:** `/sala-plan`, `/sala-estado`, `/sala-orden`, `/sala-entregar`, `/sala-seguir`, `/sala-fusionar`, `/sala-adoptar`, `/sala-soltar`, `/sala-pausar` y `/sala-novedades`, que lee qué cambió en Gentle Shell y en pi desde la versión revisada y solo propone. El bloque de la sala nombra `/sala-pausar`.
- **La respuesta del miembro**: `sala respuesta` trae su último mensaje, leído de su archivo de sesión y con los secretos enmascarados, y `/sala-orden` la muestra al terminar la orden.
- **Los bloques administrados** de la sala y del miembro, en `templates/`.
- **El motor de entrega** en `engine/`: la copia de `flow-commit` y `flow-pr` del commit `1c60a98` de flow-skills (0.3.1), con su origen en `engine/source.json`. Todavía no lo usa ningún comando.
- **El formato de commits y PR** (D23) en `src/formato.js`: el título del PR con la regla del commit y el ID de la tarea al final, el aviso de 72 caracteres, Jira con su interruptor y el idioma de las secciones del PR. `options.language` ahora solo acepta `es` o `en`.
- **La entrega del miembro con el motor del kit**: `sala motor commit|pr`, que revisa el título del PR antes de sellarlo, y los comandos `/miembro-entregar` y `/miembro-base`.
- **Las sesiones hospedadas** (opcional): `sala hospedar` mantiene viva una sesión sin pantalla del miembro por el RPC de pi y le habla por un pipe con nombre. `sala enviar`, `sala preguntas` y `sala responder` la usan, y contestan desde la sala toda pregunta menos los consentimientos, que el anfitrión retiene. Esos los da la persona con `sala consentir`, solo en una terminal interactiva y tipeando la opción en ese momento.
- **Los demás comandos del miembro**: `/miembro-tarea [ID]` toma y empieza una tarea del roadmap y `/miembro-informe` cuenta el avance. La sala (`/sala-plan`, `/sala-seguir`, `/sala-entregar` y `sala fusionar`) manda estos comandos, nunca `/flow-*`. El bloque del miembro cambió: los nombra y dice que la entrega es solo con `/miembro-entregar`. Después de actualizar, revisá que cada miembro cargue el kit antes de mandarle órdenes.
- **Los agentes del kit**: `sala instalar` copia el agente `miembro-entrega` a `~/.gentle-shell/agent/agents/` con su versión, sin fijar modelo, y nunca pisa una copia editada sin `--forzar`. `sala revisar` avisa en `kit.agents` cuando falta o quedó vieja, y `/miembro-entregar` le delega la entrega si está instalado. Después de actualizar el kit, corré `sala instalar` una vez por máquina.
- **El contrato con Gentle Shell** (D47): `contrato/gentle-shell.json` anota con qué Gentle Shell (4.9.0, pi 1.5.2) y qué formato del feed se probó el kit. `sala revisar` lo compara en `kit.gentleShell` con lo instalado y con lo que publican las sesiones vivas, y avisa si no coincide.
