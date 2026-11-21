# Mediciones de SK2a

Comprobaciones previas de la fase 2, hechas el 2026-11-20 en la máquina de la persona (Windows 11, Orca 1.4.266), con su OK para cada cosa que se tocó fuera del repo. Responden a la sección «Por comprobar» de [`DISENO.md`](DISENO.md).

| Punto | Resultado | Decisión que toca |
| --- | --- | --- |
| 1. Gentle Shell despierta a una sala ociosa cuando termina un trabajo en segundo plano | **Se despierta** | D15 |
| 2. `send_prompt` y `answer_question` por la bandeja en una sesión de Orca | **Sin medir**: la política de seguridad bloquea la carpeta del feed | D13, D17, D46 |
| 3. `orca terminal create --worktree`, `switch` y `close` | **Funciona** | D14, D29 |
| 4. `wt -w 0 new-tab` | **Abrió una ventana nueva**, no una pestaña en la abierta | D14 |
| 5. `ask_user_choice` en la terminal de Orca | **Se ve y se elige bien** | D17 |

## 1. Una sala ociosa se despierta

Cómo se mide: la sala lanza un trabajo en segundo plano (`bash_background`, un `sleep` de 45 s), termina su turno y la persona no escribe nada. Si el aviso de fin del trabajo abre un turno nuevo sin que nadie escriba, la sala ociosa se despierta.

Resultado: **se despierta**. El trabajo corrió de 23:44:50 a 23:45:35 (UTC) y la persona no escribió. El aviso de fin abrió un turno nuevo, marcado como notificación del sistema y no como mensaje de la persona, y su primera orden corrió a las 23:45:53: unos 18 s después del fin, contando el tiempo del modelo. D15 se sostiene: `sala esperar` puede ser un trabajo en segundo plano, y la sala retoma sola cuando termina.

## 2. La bandeja del feed

No se midió. Con el OK de la persona para leer solo el feed y la bandeja, listar `~/.gentle-shell/agent/desktop` desde la sesión del agente lo frenó la política de seguridad de Gentle AI:

> Gentle AI safety policy blocked access to sensitive path: ~/.gentle-shell/agent/desktop.

No se buscó otro camino para leerla. Esto también afecta a SK2f: el adaptador feed lee justo esa carpeta. Antes de SK2f hay que decidir con la persona cómo se lee el feed de forma permitida (por ejemplo, si Gentle Shell ofrece una lectura del feed que no pase por la carpeta, o si la política se ajusta para la CLI `sala`). No se debe esquivar la política leyendo la carpeta desde un proceso hijo.

## 3. Orca: abrir, mostrar y cerrar

Probado en el proyecto sala-kit, que ya estaba en Orca.

| Orden | Tiempo | Qué devolvió |
| --- | --- | --- |
| `orca terminal create --worktree path:C:/Users/victor/Developer/Tools/sala-kit --title SK2a-prueba --command "echo SK2a-medicion" --json` | 2,3 s | `ok: true`, un `handle` (`term_…`), `processId`, `tabId` y `surface: "visible"` |
| `orca terminal read --terminal <handle> --json` | — | `status: "running"` y la salida `SK2a-medicion` seguida del prompt de PowerShell en la carpeta del proyecto |
| `orca terminal switch --terminal <handle> --json` | 2,1 s | `navigated: true`; Orca mostró la pestaña |
| `orca terminal close --terminal <handle> --tab --json` | 1,5 s | `closeMode: "tab"` y `ptyKilled: false` |

Lo vio la persona: la pestaña apareció dentro del proyecto sala-kit, se mostró y se cerró.

Detalles para el adaptador:
- La terminal arranca con **PowerShell** como shell del anfitrión; `--command` se escribe dentro de ella. Si hace falta otra shell, va `--shell`.
- Después de `close`, el proceso ya no existe y la terminal no sale en `terminal list`, pero `terminal show` **todavía devuelve su registro** con `connected: false`. Para saber si una sesión sigue viva hay que mirar `list` o `connected`, no que `show` responda.
- `ptyKilled: false` aun con el proceso terminado: no sirve como prueba de cierre.
- La ayuda de `switch` dice que un agente solo debe usarlo cuando la persona pidió cambiar de pestaña. `sala mostrar` cumple eso: lo pide la persona.

## 4. Windows Terminal

`wt -w 0 new-tab --title SK2a-prueba cmd /k echo SK2a-medicion` terminó con código 0 en 1,9 s, pero según la persona **se abrió en una ventana nueva**, no como pestaña en la ventana abierta. `-w 0` apunta a la última ventana usada y, si no encuentra una, crea otra. Falta confirmar si había una ventana de Windows Terminal abierta en ese momento; hasta entonces, D14 no puede prometer «una pestaña más en la ventana abierta».

## 5. Preguntas con opciones en Orca

La sesión que hizo estas mediciones corre en una terminal de Orca. La persona contestó por `ask_user_choice` y por un cuestionario de varias preguntas, y dijo que las opciones se leen y se eligen bien.
