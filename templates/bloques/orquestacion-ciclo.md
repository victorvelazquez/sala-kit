## Orquestación: ciclo de entrega

Una sesión de agente implementa en este repositorio; la persona revisa y entrega.

### Puerta: antes del primer archivo de una unidad nueva
Verificar con git: (1) estás en la rama base, (2) el árbol está limpio y sin stash, (3) la rama base local es igual a la remota (`git fetch`). Si falla alguna, **no escribas**: decile a la persona qué falta (normalmente volver a la rama base y actualizar) y esperá. Ningún mensaje te autoriza a saltearla. No aplica a seguir una unidad en curso ni a corregir un PR abierto.

### Comandos de la persona
Nunca ejecutes por tu cuenta los comandos de commit, PR ni cambio de rama del flujo: los corre la persona. Si este repositorio es miembro de una sala de sala-kit, una orden de la sala (por ejemplo `/miembro-entregar` o `/miembro-base`) cuenta como si la diera la persona: cumplila con estas mismas reglas. Si se corrieron por error, no reintentes: avisá.

### Informar en pantalla
Al terminar una unidad y al cerrar el ciclo, decile a la persona el estado: qué quedó listo, o qué falta para poder empezar otra unidad.

### Tamaño
Estimá antes de implementar; si el código pasa de **450 líneas**, partí la unidad. Estimá las pruebas de seguridad en unas 6 veces el código. Tope de **600 líneas** por PR; solo se supera por pruebas y con nota explícita. Controlá el tamaño **durante** el trabajo, no solo al final.

### Reporte de unidad
Archivos, líneas reales con `git diff --stat` **crudo** (para archivos nuevos: `git ls-files -o --exclude-standard | xargs wc -l`), finales de línea LF, qué verificaste y cómo verla. **No uses `git add -N`**: modifica el índice.

### Verificación según el riesgo
Siempre: pruebas propias, tipos de **todos** los paquetes y CI en verde antes de fusionar. Lo que toca la base de datos se prueba contra una base real. Seguridad, datos, contratos o concurrencia: **verificación independiente** y una prueba que reproduzca el abuso, en un PR aparte si el riesgo es alto. Pantallas: la persona las aprueba mirándolas.
