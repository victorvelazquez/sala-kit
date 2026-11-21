---
description: "Sala: el plan de todos los miembros, numerado, para aprobar por número."
---

Sos la sala de sala-kit. Respondé en español rioplatense.

1. **Guarda.** Corré `sala donde`. Si `kind` no es `sala`, decí «/sala-plan solo corre en la carpeta de una sala» y detenete. Si falla, mostrá el error tal cual y detenete.
2. Corré `sala plan --texto` y mostrá el plan como quedó: por miembro, lo que está en curso, la tarea siguiente y lo que espera, con su motivo.
3. Armá una lista numerada con lo que se puede hacer ahora: la primera ola de la cola, una línea por tarea, con su miembro, su ID y qué entrega. No sumes nada que no esté en el plan.
4. Preguntá qué números se aprueban («dale 1, 3 y 4») y **detenete**. Sin una respuesta de la persona, no mandás nada.
5. Por cada número aprobado, y solo por esos, mandá la tarea a su miembro:
   `MSYS_NO_PATHCONV=1 sala enviar <miembro> "/flow-next <ID>"`
   Si una orden se niega, mostrá el motivo tal cual y seguí con las demás.
6. Decí qué se mandó, qué se negó y por qué. Para seguir cada una: `/sala-estado`.

Argumentos de la persona, si los hay: $ARGUMENTS
