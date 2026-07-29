# Instrucciones permanentes para Claude Code — DanaCorp Project

## Regla de control de versiones (CRÍTICA)

Después de COMPLETAR cualquier conjunto de cambios solicitados
por el usuario, SIEMPRE realizar este flujo:

1. Presentar el resumen de cambios al usuario
2. Preguntar EXPLÍCITAMENTE:
   "¿Quieres que haga commit de estos cambios en git?
   Sugerencia de mensaje: '<mensaje descriptivo basado en lo cambiado>'
   [S] Sí, commitea con ese mensaje
   [E] Editar el mensaje antes de commitear
   [N] No commitear todavía"

3. Esperar la respuesta del usuario antes de seguir.

4. Según la respuesta:
   - Si [S]: ejecutar:
       git add -A
       git commit -m "<mensaje sugerido>"
   - Si [E]: pedir el mensaje editado, luego ejecutar commit
   - Si [N]: continuar sin commit, pero advertir:
       "⚠️ Los cambios no están en git — si se rompen, hay que
        revertir manualmente."

5. Después del commit: DETENERSE. No hacer push. Ver la regla de
   despliegue más abajo.

## Regla de despliegue (CRÍTICA — leer antes de tocar ramas)

**El despliegue NO sale de GitHub. Sale de ESTA carpeta local.** Sleyton
despliega tomando el contenido del directorio de trabajo, no haciendo
`git pull` desde origin.

Consecuencias, todas importantes:

- **El working tree ES producción.** Lo que esté checkouteado acá es lo
  que se puede desplegar en cualquier momento. `master` tiene que quedar
  siempre en un estado publicable: typecheck y suite en verde.
- **Cambiar de rama en esta carpeta expone la rama al despliegue.** Una
  rama NO aísla el trabajo en curso. Para trabajo experimental usar un
  **git worktree en otro directorio**, dejando esta carpeta en `master`.
- **El push a origin no es el mecanismo de release**, así que no es
  urgente ni se hace automáticamente. Preguntar antes; es solo respaldo
  y sincronización con GitHub (sleyton24/danacorp).
- El push HTTPS pide autenticación interactiva por Git Credential
  Manager, que no se puede completar de forma no interactiva.

## Reglas adicionales

- NUNCA hacer commit sin preguntar primero al usuario
- NUNCA hacer push sin que el usuario lo pida explícitamente
- Si el usuario dice "guarda esto" o "commitea esto", proceder
  directamente sin preguntar (interpreta como [S] implícito)
- Si el repositorio no está inicializado (git status falla),
  preguntar al usuario si quiere inicializarlo antes de cualquier cambio

## Mensajes de commit sugeridos

Usar formato descriptivo y corto (máximo 72 caracteres):
  - "Fix: descripción del bug arreglado"
  - "Feature: nueva funcionalidad agregada"
  - "Refactor: qué se reorganizó"
  - "Chore: cambios de configuración o limpieza"
  - "UI: ajustes visuales en componente X"
