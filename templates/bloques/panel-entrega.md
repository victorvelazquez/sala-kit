## Panel: entrega del trabajo (ramas, commits y PR)

**Quién entrega.** La persona, en una sesión que abre a mano, con `/flow-base`, `/flow-commit` y `/flow-pr` (o `/flow-ship`), o con `/miembro-base` y `/miembro-entregar`. Si este repositorio es miembro de una sala de sala-kit, las órdenes de la sala entregan con `/miembro-entregar` y vuelven a la base con `/miembro-base`, y cuentan como si las diera la persona. Los dos caminos usan el mismo motor de entrega: deciden el nombre de la rama, el mensaje del commit y el texto del PR. Vos escribís los cambios y los dejás en el árbol de trabajo.

**Prohibido.** Commitear por cualquier otro medio que no sean esos comandos: ni `git commit` suelto, ni desde un IDE, ni con un script, ni «para guardar», ni en una rama propia. Tampoco crear ni cambiar de rama, hacer push, abrir ni fusionar un PR por fuera de ellos. Nada de `git add` ni `git mv`: el índice queda vacío, porque el motor de entrega se niega a arrancar con archivos en el índice. Si algo de esto se hizo por error, no lo reviertas ni lo repitas: avisale a la persona.

**Al terminar.** Decile a la persona qué sigue (normalmente `/flow-commit`, o `/miembro-entregar` si la tarea la mandó la sala) y el ID de la tarea, para que lo lleve al título del PR o al nombre de la rama.
