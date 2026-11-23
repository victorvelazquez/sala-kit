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
- **`sala proximo`** (SK32): el paso siguiente de cada miembro, con el comando exacto, sin modelo y solo leyendo. El bloque de la sala describe el ciclo de un miembro y dice que «¿qué sigue?» se contesta con `sala proximo`; después de actualizar el kit, `sala actualizar` lo pone al día en cada sala.
- **`sala esperar` después de una orden** (SK29): ya no la da por terminada antes de que el miembro la empiece. `sala enviar` anota en `.sala/ordenes.log` el costo y el contexto que tenía la sesión (`before`), y `sala esperar` cuenta el tiempo libre solo cuando cambiaron o la sesión trabajó; si no arranca en 2 minutos, lo dice.
- **Carriles** (SK28, D57): un miembro de `sala.json` puede ser carril de otro del mismo repo, trabajado desde otro clon, con `"lane": { "of": "<miembro>", "rows": [IDs] }` y sin `prefix` propio. Cada fila del roadmap compartido es de un solo carril en `sala plan`, en la cola y en la tarea siguiente de `sala fusionar`; `sala enviar` niega un `/miembro-tarea` con una fila del otro carril o sin ID. `/sala-seguir` ahora manda la tarea con el ID que da `sala plan`. Un `sala.json` sin carriles queda igual.
- **Las dependencias al volver a la base** (SK24): `sala dependencias [--instalar]` instala con `pnpm install --frozen-lockfile` o `npm ci` solo si falta `node_modules` o el lockfile cambió después de la última instalación. `/miembro-base` lo corre al final, y `sala veredicto <miembro> base` suma el chequeo `deps` para los miembros con lockfile.
- **La sesión que aparece tarde** (SK17): si Gentle Shell publica la sesión después de que `sala abrir` dejó de esperar, `sala abrir` y `sala reiniciar` la anotan como de la sala cuando la terminal de Orca sigue abierta y es la única sesión del miembro. Antes, `sala fusionar` se frenaba en `restart`.
- **La entrega de los miembros** (SK16): `/miembro-entregar` le dice al agente de entrega que los ordinales se cuentan desde 0, que el token es solo el campo `payloadB64url` y que va directo en el comando. Antes, la primera entrega real gastó su corrección y quedó sin commit.
- **La respuesta del miembro**: `sala respuesta` trae su último mensaje, leído de su archivo de sesión y con los secretos enmascarados, y `/sala-orden` la muestra al terminar la orden.
- **Los bloques administrados** de la sala y del miembro, en `templates/`.
- **Los bloques viejos de los miembros** (D52): `sala unirse` pone `panel:tareas`, `panel:entrega` y `orquestacion:ciclo` en su versión compatible con la sala (`templates/bloques/`), y agrega o pone al día el bloque del miembro, siempre entre las marcas; ya no deja `AGENTS.md.sugerido`. El bloque del miembro cambió: la persona, a mano, también puede entregar con `/flow-*`. Después de actualizar el kit, corré `sala unirse` en cada miembro, en una tarea propia. `sala revisar` suma el requisito `old-blocks` (son 8): falla mientras un miembro tenga esos bloques en una versión vieja, y `sala condiciones` le manda la orden. El aviso fijo por `panel:entrega` desaparece.
- **El motor de entrega** en `engine/`: la copia de `flow-commit` y `flow-pr` del commit `1c60a98` de flow-skills (0.3.1), con su origen en `engine/source.json`. Todavía no lo usa ningún comando.
- **El formato de commits y PR** (D23) en `src/formato.js`: el título del PR con la regla del commit y el ID de la tarea al final, el aviso de 72 caracteres, Jira con su interruptor y el idioma de las secciones del PR. `options.language` ahora solo acepta `es` o `en`.
- **La entrega del miembro con el motor del kit**: `sala motor commit|pr`, que revisa el título del PR antes de sellarlo, y los comandos `/miembro-entregar` y `/miembro-base`.
- **Las sesiones hospedadas** (opcional): `sala hospedar` mantiene viva una sesión sin pantalla del miembro por el RPC de pi y le habla por un pipe con nombre. `sala enviar`, `sala preguntas` y `sala responder` la usan, y contestan desde la sala toda pregunta menos los consentimientos, que el anfitrión retiene. Esos los da la persona con `sala consentir`, solo en una terminal interactiva y tipeando la opción en ese momento.
- **Los demás comandos del miembro**: `/miembro-tarea [ID]` toma y empieza una tarea del roadmap y `/miembro-informe` cuenta el avance. La sala (`/sala-plan`, `/sala-seguir`, `/sala-entregar` y `sala fusionar`) manda estos comandos, nunca `/flow-*`. El bloque del miembro cambió: los nombra y dice que la entrega es solo con `/miembro-entregar`. Después de actualizar, revisá que cada miembro cargue el kit antes de mandarle órdenes.
- **Los agentes del kit**: `sala instalar` copia el agente `miembro-entrega` a `~/.gentle-shell/agent/agents/` con su versión, sin fijar modelo, y nunca pisa una copia editada sin `--forzar`. `sala revisar` avisa en `kit.agents` cuando falta o quedó vieja, y `/miembro-entregar` le delega la entrega si está instalado. Después de actualizar el kit, corré `sala instalar` una vez por máquina.
- **El contrato con Gentle Shell** (D47): `contrato/gentle-shell.json` anota con qué Gentle Shell (4.9.0, pi 1.5.2) y qué formato del feed se probó el kit. `sala revisar` lo compara en `kit.gentleShell` con lo instalado y con lo que publican las sesiones vivas, y avisa si no coincide.
