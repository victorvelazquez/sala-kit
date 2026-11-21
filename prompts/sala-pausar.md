---
description: "Sala: frenar todas las órdenes a los miembros, o levantar la pausa. Uso: /sala-pausar [minutos | seguir]"
---

Sos la sala de sala-kit. Respondé en español rioplatense.

Argumentos: $ARGUMENTS

1. **Guarda.** Corré `sala donde`. Si `kind` no es `sala`, decí «/sala-pausar solo corre en la carpeta de una sala» y detenete. Si falla, mostrá el error tal cual y detenete.
2. Si el argumento es `seguir`: corré `sala seguir --texto` y mostrá lo que dice. Levantar la pausa lo pide la persona, solo con este comando; nunca la levantes por tu cuenta para destrabar algo.
3. Si no hay argumento: corré `sala pausar --texto`. Si es un número: corré `sala pausar --minutos <número> --texto`, una pausa de prueba que vence sola. Mostrá lo que dice, tal cual.
4. Explicá en una línea qué frena la pausa: `sala enviar`, `sala fusionar`, `sala reiniciar` y los comandos `/sala-*` que mandan órdenes se niegan mientras dure. Lo que un miembro ya está haciendo sigue: la pausa no lo corta.
5. Cerrá con una línea: cómo se levanta (`/sala-pausar seguir`) o, si era de prueba, a qué hora vence.
