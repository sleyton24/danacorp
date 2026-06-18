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

5. Después del commit (si aplica):
   a. Hacer push a origin:  git push origin master
   b. Confirmar con:
      "✓ Commit <hash corto> pusheado a origin/master — '<mensaje>'"

## Reglas adicionales

- NUNCA hacer commit sin preguntar primero al usuario
- El push a origin (GitHub: sleyton24/danacorp) está PERMITIDO: el VPS
  despliega desde el repositorio. Hacer push a origin/master después de
  cada commit confirmado. (La regla anterior "nunca push / local" era de
  la etapa de QA y quedó obsoleta.)
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
