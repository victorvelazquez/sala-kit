# Cambios de sala-kit

Cada versión dice qué cambió para las salas que ya existen. Después de actualizar el kit, corré `sala actualizar` en cada sala: anota la versión en `kit` de `sala.json`, migra su formato si cambió y reescribe el bloque de la sala en su `AGENTS.md`.

## 0.1.0 (sin publicar)

La primera versión. `sala.json` tiene `schema: 1`.

- **La CLI `sala`.** Cubre:
  - crear y mirar la sala: `init`, `donde`, `estado`, `plan` y `revisar`;
  - las sesiones de los miembros: `abrir`, `mostrar`, `enviar`, `esperar`, `preguntas` y `responder`;
  - juzgar y fusionar: `veredicto`, `fusionar`, `reiniciar` y `modelo`;
  - los miembros: `adoptar`, `soltar`, `unirse` y `condiciones`;
  - poner la sala al día: `actualizar`.
- **Los comandos de Gentle Shell:** `/sala-plan`, `/sala-estado`, `/sala-orden`, `/sala-entregar`, `/sala-seguir`, `/sala-fusionar`, `/sala-adoptar` y `/sala-soltar`.
- **Los bloques administrados** de la sala y del miembro, en `templates/`.
