# Diseño de sala-kit

Decisiones acordadas con la persona el 2026-11-20, después de pilotear la sala de upen en la terminal con Gentle Shell y Orca (ciclo completo probado con upen-brand M2c, PR #11). Cada decisión lleva un número para poder citarla desde el roadmap (`D3`, `D12`…).

## Por qué existe

La sala de upen funciona, pero hace con el modelo mucho trabajo mecánico. Medido el 2026-11-20:
- **al arrancar** lee unos 70 KB (AGENTS, ESTADO, TABLERO), unos 20.000 tokens, de nuevo tras cada compactación;
- **el plan del día** lee los roadmaps de 7 repos, unos 114 KB y 30.000 tokens;
- **`estado-vivo.sh`** tarda 97 s y marca NO LISTO a todos los repos sin decir por qué. Dentro del script falla el `git fetch` y anota «no se pudo consultar el remoto», mientras `puerta-de-ciclo.sh`, corrida sola, da LISTO para los mismos repos. La causa no está confirmada;
- **un `/flow-ship` mandado por la sala** cuesta varios turnos solo para esperar mirando la pantalla.

Además, la sala está atada a upen: los repos en `proyectos.conf`, supuestos de upen en los scripts y las reglas en el `AGENTS.md` de upen-ceo. La persona quiere replicarla (por ejemplo, `h2o-sala`).

**Principio:** lo mecánico lo hace un script que devuelve JSON; el modelo coordina, resume y pregunta.

## Nombres

- **D1.** **Sala** es la sesión que coordina, y la carpeta que la contiene es la **instancia**. Los repos que coordina son sus **miembros**. Un repo puede no ser miembro de ninguna sala.
- **D2.** El código, los identificadores y las claves de JSON van en inglés. Los comandos que escribe la persona y los textos que lee van en español.

## Kit, instancia y estado

- **D3.** El **kit** (este repo) es el motor: la CLI, los comandos, el catálogo de requisitos, las plantillas y los adaptadores. No contiene nada de ningún proyecto.
- **D4.** La **instancia** es la carpeta de cada sala, con un `sala.json` versionado. Ejemplo:

```json
{
  "schema": 1,
  "kit": "0.1.0",
  "name": "upen",
  "members": [
    { "id": "core", "prefix": "CORE", "path": "C:/Users/victor/Developer/upen/upen-core", "base": "develop", "remote": "origin" },
    { "id": "brand", "prefix": "BRAND", "path": "C:/Users/victor/Developer/upen/upen-brand", "base": "develop", "remote": "origin" }
  ],
  "options": {
    "language": "en",
    "jira": false,
    "transport": "orca",
    "roomModel": null
  }
}
```

  El formato exacto de los campos lo fija SK1a; este ejemplo es la intención. Las rutas son de la máquina, igual que hoy en `proyectos.conf`.
- **D5.** El **estado vivo** de la sala va en `.sala/estado.json` dentro de la instancia, sin versionar: las sesiones abiertas por miembro, las órdenes en vuelo y las aprobaciones pendientes. Si la sala se compacta o se reinicia, retoma leyendo ese archivo y no de memoria.
- **D6.** `sala.json` **también se edita a mano**. `/sala-adoptar` es la forma cómoda, no la única. Después de editarlo, `sala revisar` dice si quedó bien.

## JSON o Markdown

- **D7.** **JSON** para lo que escribe y lee una máquina: la salida de la CLI, `sala.json` y el estado vivo. **Markdown** para lo que escribe o lee la persona: decisiones, estrategia, tablero.
- **D8.** **Los roadmaps de los miembros siguen en Markdown** (`docs/ROADMAP.md`, formato de Orquestación 1.0). Los leen la persona, el panel y los comandos; la CLI los convierte. Pasarlos a JSON rompería todo eso a cambio de nada.

## La CLI `sala`

- **D9.** **En Node, sin dependencias, sin bash.** Los dos problemas del piloto vinieron de Git Bash: la `/` de `/flow-ship` convertida en ruta y el `fetch` que falla dentro de `estado-vivo.sh`.
- **D10.** **Toda salida es JSON compacto** por defecto, con `--texto` para leerla una persona. Ese JSON es un **contrato**: el panel lo va a consumir (D30), así que cambia con versión.
- **D11.** **Subcomandos:**

| Subcomando | Qué hace |
|---|---|
| `sala estado` | La foto real de cada miembro: rama, árbol, stash, igual al remoto, PR abiertos y su CI, la puerta **con su motivo**. En paralelo. Reemplaza `estado-vivo.sh` |
| `sala plan` | Por miembro: la tarea en curso, la siguiente lista y lo bloqueado y por qué. **Resuelve las dependencias con prefijo entre miembros** (`CORE-E09` se busca en el roadmap de core). Unos 2 KB en vez de 114 KB |
| `sala revisar [miembro]` | Qué requisitos cumple cada miembro y cuáles no (D24) |
| `sala abrir <miembro>` | Reusa la sesión viva del miembro o abre una nueva y espera a que esté lista |
| `sala enviar <miembro> <comando> [args]` | Manda **cualquier** comando con las mismas guardas (D13) |
| `sala esperar <miembro>` | Termina cuando la sesión terminó su turno (D15) |
| `sala veredicto <miembro> <comando>` | Las comprobaciones fijas de cada comando, en JSON (D16) |
| `sala fusionar <miembro> <n>` | La cadena de fusión (D18) |
| `sala init` | Crea una sala en una carpeta: `sala.json`, el `AGENTS.md` con sus bloques y la carpeta `.sala/` ignorada |
| `sala actualizar` | Lleva la instancia a la versión instalada del kit (D27) |

- **D12.** Los miembros se nombran por su `id` de `sala.json`, nunca por ruta.

## Mandar órdenes a los miembros

- **D13.** `sala enviar` siempre:
  - busca la sesión del miembro en el estado vivo;
  - comprueba que esté esperando entrada y **se niega si está trabajando**;
  - manda el texto tal cual, sin la traducción de rutas de Git Bash;
  - anota la orden en el estado vivo.
- **D14.** **Capa de transporte con adaptadores.** El núcleo solo conoce cuatro operaciones: abrir sesión, enviar, leer y esperar. Nunca llama a Orca directamente.

| Adaptador | Cuándo | ¿Orca? |
|---|---|---|
| **Orca**: terminales visibles (`orca terminal create/send/read`) | Primero, porque está probado | Sí |
| **RPC de pi**: el que repo-panel ya usa en `server/rpchost.js` | Cuando el panel integre el kit (D30) | No |
| **Zellij** | Opcional, terminal sin Orca | No |

- **D15.** **No se usa el correo de orquestación de Orca** (`run-create`, `worker-start`, `inbox`). En el piloto, el coordinador tenía que ser una terminal de Orca, `--agent pi` no está configurado y `orca terminal wait --for tui-idle` dio la sesión por ociosa mientras seguía trabajando. `sala esperar` vigila en cambio **el archivo de sesión de pi** del miembro, donde queda el fin de cada turno. La sala lo corre como trabajo en segundo plano de Gentle Shell y **duerme sin gastar tokens** hasta que el script termina y la despierta.
- **D16.** **El veredicto tiene reglas por comando**, definidas en el kit y no en el prompt. Por ejemplo:
  - después de entregar: rama, último commit, PR y CI;
  - después de volver a la base: en la base, limpio y al día.
- **D17.** **Preguntas con opciones.** Toda decisión con alternativas finitas se pregunta con la herramienta `ask_user_choice` de Gentle Shell: la opción recomendada primero y texto libre solo si la respuesta es abierta. Las preguntas de un miembro que necesitan a la persona suben a la sala, y la sala las hace con opciones, **sin contestarlas por su cuenta**.

## Fusionar y seguir

- **D18.** `sala fusionar <miembro> <n>` encadena:
  1. comprueba que el PR esté en verde y sea fusionable;
  2. fusiona con el método que el repo permite;
  3. vuelve a la base en el miembro;
  4. corre la puerta;
  5. si da LISTO, pide la tarea siguiente, salvo que su fila diga `Auto: no`.

  Se detiene en el primer paso que falla y deja cada paso en un registro.
- **D19.** **Solo con el OK explícito de la persona, PR por PR.** El mensaje de la persona («fusioná el #11 de brand») es el OK. **Una fusión que la sala no hizo no dispara nada**: la persona puede estar fusionando otro repo que no es de la sala.

## Comandos

- **D20.** **Comandos de la sala**, plantillas de Gentle Shell que escribe la persona: `/sala-plan`, `/sala-estado`, `/sala-orden`, `/sala-entregar <miembro>`, `/sala-fusionar <miembro> <n>`, `/sala-seguir <miembro>`, `/sala-adoptar`, `/sala-soltar <miembro>` y `/sala-revisar`. Cada uno llama a su subcomando; así la sala no interpreta frases libres. El plan se aprueba por número («dale 1, 3 y 4»).
- **D21.** **Comandos del miembro**, que manda la sala o escribe la persona en el repo: `/miembro-tarea <ID>`, `/miembro-entregar`, `/miembro-base` y `/miembro-informe`. Son prompts nuevos y propios del kit, que no dependen de flow-skills.
- **D22.** **El motor de entrega se copia, no se reescribe.** `flow-commit` (unas 2.400 líneas transaccionales: bloqueo, reversión, índice vacío obligatorio, detección de merge o rebase en curso) y `flow-pr` (unas 790 líneas: base resuelta sin adivinar, actualización de un PR existente, verificación con `gh`) van **copiados dentro del kit, con su versión anotada**. `/miembro-entregar` los usa. Reescribirlos sería riesgo puro sobre el historial de Git.
- **D23.** **Formato de commits y PR**, configurable desde `sala.json`:
  - el formato de flow-commit: `tipo(ámbito)!: resultado` (Conventional Commits 1.0), con **el ámbito opcional**;
  - **el título del PR se valida con la misma regla** que el commit;
  - **el ID de la tarea siempre al final, entre paréntesis**: `docs(guide): document theme H (M2c)`;
  - un **límite suave de 72 caracteres** en el título;
  - el **idioma** de los PR desde `options.language`;
  - las secciones del PR: Summary, Changes, Validation, Risks y Out of scope, con «Not run» en vez de pruebas inventadas;
  - **Jira con su interruptor** (`options.jira`): apagado en upen; en h2o se resuelve después.

## Adopción y requisitos

- **D24.** **Catálogo de requisitos**, versionado en el kit. Cada requisito tiene un id, una comprobación (script) y la orden para cumplirlo. Los primeros:
  - `docs/ROADMAP.md` con el formato de tareas y su cabecera;
  - el bloque administrado de la sala en `AGENTS.md`;
  - la rama base y el remoto de `sala.json`.
- **D25.** **`/sala-adoptar` es una conversación:**
  1. pregunta qué carpetas mirar;
  2. corre `sala revisar` en cada repo;
  3. muestra con opciones cuáles adoptar y los agrega a `sala.json`;
  4. a los que no cumplen les manda, con el OK de la persona, la orden de ponerse en condiciones;
  5. los vuelve a revisar.

  `/sala-soltar <miembro>` saca un repo de la sala sin tocar el repo.
- **D26.** **Quién manda en los miembros: la sala.** El kit instala su propio bloque administrado en el `AGENTS.md` de cada miembro. El bloque `panel:entrega` de repo-panel, que hoy dice que la entrega es **solo** con `/flow-*`, choca con `/miembro-entregar`. Se retira de los miembros en la fase 5, **no antes**: hasta entonces los miembros siguen con `/flow-*` y no hay choque.

## Actualizar las salas

- **D27.** **El kit se instala una vez en la máquina**, con la CLI y los comandos, y todas las salas usan esa copia: mejorar un comando mejora todas las salas. Cada sala anota en `sala.json` con qué versión quedó (`kit`). `sala actualizar`:
  - migra `sala.json` si cambió su formato;
  - reescribe los bloques administrados del `AGENTS.md` de la sala, que son el texto entre marcas, sin tocar lo de afuera;
  - vuelve a revisar a los miembros y propone, con OK, la orden de ponerse en condiciones.

  El `CHANGELOG.md` del kit dice qué trae cada versión.

## El modelo y las sesiones

- **D28.** **Un modelo más barato para la sala**, porque con los scripts solo coordina y resume. Va por parámetro al abrirla (`options.roomModel`), **sin tocar ninguna configuración global**. Los miembros siguen con el modelo fuerte para implementar.
- **D29.** **Una sesión nueva por unidad en cada miembro.** Después de la cadena de fusión se cierra la sesión, y la próxima `/miembro-tarea` arranca en una limpia. Arrancar cuesta unos 45 s; gasta menos contexto y se confunde menos.

## Relación con repo-panel

- **D30.** **Arquitectura hexagonal.** sala-kit es el núcleo; la terminal con Gentle Shell es un adaptador, y la interfaz del panel será otro. El panel ya lanza pi por RPC, así que con el kit integrado **Orca deja de hacer falta** sin tocar el núcleo. El panel va a consumir el kit, ya sea por su JSON o importándolo como librería: Conformity usa `sala revisar`, el plan usa `sala plan` y los botones usan `sala enviar`.
- **D31.** **repo-panel está en pausa** desde el 2026-11-20, por decisión de la persona, hasta que el kit funcione. Su fila RP255 replantea el panel sobre el kit. Si los dos repos se fusionan o quedan separados se decide entonces.

## Lo propio de upen (no va en el kit)

- **D32.** `TABLERO.md` deja de copiar el estado de las filas (por eso se desactualiza; pasó con M2c) y guarda solo lo que no está en ningún roadmap: orden entre carriles, prioridades, el piso del evento, puertas y lo que espera a la persona. `ESTADO.md` se recorta. Las reglas de coordinación pasan a un archivo que la sala lee solo cuando coordina. Es la fase 6 y se escribe en upen-ceo.

## Por comprobar

| Qué | Por qué importa | Dónde se comprueba |
|---|---|---|
| Que Gentle Shell despierte a una sala **ociosa** cuando termina un trabajo en segundo plano. Se vio en medio de un turno, no ociosa | `sala esperar` depende de eso (D15) | SK2a |
| Dónde guarda pi el archivo de sesión de cada miembro y cómo se marca el fin de turno | `sala esperar` lo vigila (D15) | SK2a |
| Cómo se ve `ask_user_choice` en la terminal de Orca. Se midió por RPC en RP237, no en la terminal | D17 | SK2a |
| Por qué falla el `git fetch` dentro de `estado-vivo.sh` | Que `sala estado` no repita el error | SK1a |
| Si un modelo por parámetro se puede pasar al abrir Gentle Shell sin tocar su configuración | D28 | SK3c |

## Decisiones de la segunda ronda (2026-11-20)

Salen de dos revisiones de solo lectura: el proyecto `escritorio-ia-kit` y cómo instala y descubre comandos Gentle Shell (pi). La persona las aprobó todas el mismo día y dio su OK para registrar el kit en la configuración de Gentle Shell.

### Instalación y nombres de los comandos

- **D33. El kit es un paquete de pi, referenciado en su lugar**, como flow-skills: `package.json` con la clave `pi` (`prompts` y `skills`), registrado una vez en el `settings.json` de Gentle Shell. pi lo lee desde la carpeta del repo, sin copiar, así que actualizar es `git pull` y `/reload`. Esto cumple D27. Ojo: la máquina tiene dos casas, `~/.gentle-shell/agent`, la que usa Gentle Shell, y `~/.pi/agent`, la de pi solo. Registrado el 2026-11-20 en las dos casas, con el OK de la persona.
- **D34. Los agentes propios se copian.** Un paquete de pi no instala agentes. Los de flow-skills se copian a mano a `agents/` y quedaron con un modelo agregado localmente. Si el kit necesita agentes, por ejemplo el de entrega con un modelo más barato, `sala instalar` los copia con su versión, y `sala revisar` avisa cuando la copia quedó vieja.
- **D35. Comandos globales con guarda**, en lugar de comandos por carpeta. pi puede cargar comandos solo en un proyecto (`.pi/settings.json`), pero eso escribe en cada miembro y pide confiar en la carpeta (`/trust`). Más simple: instalarlos globales, y que cada comando primero pregunte a la CLI dónde está y se niegue en la carpeta equivocada, por ejemplo un comando de sala fuera de una sala.
- **D36. Un prefijo por familia: `sala-` para los comandos de la sala y `miembro-` para los de los miembros.** El buscador de `/` de pi es difuso y premia los inicios de palabra, que también cuentan después de un `-`. Por eso **escribir `/plan` igual encuentra `/sala-plan`**: el prefijo no cuesta letras.
  - Con `/sala` aparecen todos juntos, como `/flow`.
  - Se evitan choques con otros paquetes instalados que no se revisaron.
  - Con `/` solo, la lista sale en el orden de su origen, no alfabética: el prefijo agrupa recién cuando escribís algo.

| Familia | Comandos |
|---|---|
| Sala | `/sala-plan`, `/sala-estado`, `/sala-orden`, `/sala-entregar`, `/sala-fusionar`, `/sala-seguir`, `/sala-adoptar`, `/sala-soltar`, `/sala-revisar`, `/sala-pausar` |
| Miembro | `/miembro-tarea`, `/miembro-entregar`, `/miembro-base`, `/miembro-informe` |

### Lo que conviene tomar de escritorio-ia-kit

- **D37. Retomar leyendo un archivo.** Al arrancar, la sala corre un resumen corto del estado vivo, por ejemplo `sala estado --retomar`, y no relee documentos largos. La regla: lo que no está en el archivo no pasó. Viene de `scripts/obra.mjs` y `estado/obra.json`. Refuerza D5.
- **D38. `sala pausar` y `sala seguir`.** Un archivo `.sala/PAUSA` frena toda orden: `enviar`, `fusionar` y cualquier cadena en segundo plano lo miran primero. Solo la persona lo levanta, y una pausa de prueba vence sola. Viene de `scripts/pausar.mjs` y del hook `pausa`. No reemplaza el OK de cada fusión (D19).
- **D39. Pruebas de guardas sin modelo.** Se le pasan órdenes de ejemplo a un transporte falso y se comprueba que se acepten o se nieguen. Si la entrada no se puede leer, la orden se niega. Viene de `scripts/testar-travas.mjs`. Es el estilo de prueba de SK2c y SK4b.
- **D40. Cadenas con topes y registro.** Un tope de pasos y de tiempo, los argumentos sin pasar por una shell (`spawnSync` con lista), y una línea de registro por paso. Viene de `scripts/rodar-rotina.mjs`. Va en SK3b.
- **D41. Escribir sin pisar.** `sala init` y `/sala-adoptar` nunca sobrescriben: informan qué hicieron y qué saltearon. Si un `AGENTS.md` no tiene las marcas del bloque administrado, dejan al lado un archivo `.sugerido`. Viene de `scripts/iniciar.mjs`. Va en SK3a, SK4a y SK4b.
- **D42. Requisitos de higiene.** El catálogo de `sala revisar` suma un tamaño máximo para `AGENTS.md` y que no haya secretos en `sala.json` ni en las reglas. Viene de `scripts/brain-lint.mjs`. Va en SK1c.
- **D43. Más adelante, opcional: evals de los comandos de la sala.** Casos en JSONL que comprueban conductas: la sala no contesta por la persona (D17) y no fusiona sin OK (D19). Llevan un tope de gasto. Viene de `evals/rodar.mjs`. Cuesta tokens, y las banderas para correr pi así no están comprobadas.
- **D44. Más adelante, opcional: programar el plan del día** con un comando que **imprime** la tarea programada de Windows y nunca la instala. Viene de `scripts/agendar.mjs`.

**No se toma:**
- el commit hecho por el agente (`obra.mjs --commit`);
- la entrevista larga guiada por prosa;
- su tablero visual, que duplica repo-panel;
- el runner para varios proveedores;
- verificar respuestas del modelo con expresiones regulares como prueba principal: el veredicto sigue siendo determinista (D16).

## Decisiones de la tercera ronda (2026-11-20)

- **D45. La cola de la sala.** Es una lista única con las tareas pendientes de todos los miembros, en el orden en que la sala las va a ejecutar, agrupada en **olas**. Una ola es lo que puede correr en paralelo.
  - **Se calcula, nunca se guarda.** No hay archivo que sincronizar, así que no se puede desactualizar como `TABLERO.md`. Se recalcula en el plan del día, después de cada `sala fusionar` y cada vez que el panel refresca. Es mecánica, sin modelo; el modelo lee solo el resultado, unos 2 KB.
  - **Las fuentes**, de más fuerte a más débil:
    1. las dependencias: las de dentro del repo, con IDs de su tabla, y las de otro miembro, con prefijo (`CORE-E09`);
    2. el orden de las filas dentro de cada roadmap;
    3. la prioridad entre miembros, escrita en `sala.json`: el orden de `members` y una lista opcional de tareas fijadas adelante. Es lo único manual, y es intención de la persona, no estado.
  - **Qué cuenta como hecho.** El roadmap se lee de la rama base remota, después del mismo `fetch` de `sala estado`. Una tarea está hecha cuando su fila dice `Completada` **ahí**. Lo que está en vuelo (una rama o un PR con el ID) sale «en revisión», no hecho, así la cola no adelanta trabajo sin fusionar.
  - **Un miembro, una tarea por ola**, porque cada miembro tiene una sola sesión y una sola rama a la vez (D29).
  - **Lo que no avanza sale con su motivo**:
    - espera a otra tarea, con el ID;
    - `Bloqueada`, con su nota;
    - espera a la persona;
    - dependencia sin resolver, por ejemplo un ID mal escrito;
    - ciclo de dependencias;
    - miembro que no se pudo leer.
  - **Salida.** `sala plan` suma el campo `queue` con las olas, y cada elemento lleva el miembro, el ID, la entrega, lo que espera y el motivo. Con `--texto`, una línea por ola.
  - **Dónde se ve.** En la terminal, como texto. La vista visual es de repo-panel, en Rooms, dentro de su replanteo (RP255). En Gentle Shell no va un widget: lo decidió la persona el 2026-11-20, porque las visualizaciones van al panel.
  - **El riesgo que queda: un PR que se fusiona sin marcar su fila `Completada`.** Lo cubre `sala veredicto` (D16): después de entregar, comprueba que la fila de la tarea del PR diga `Completada` y, si no, lo avisa antes de fusionar.
