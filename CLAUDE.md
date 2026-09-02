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
   - Si [S]: agregar los paths explícitos de lo que se tocó
       (NUNCA `git add -A`: puede haber archivos de trabajo sin trackear
        que no van al repo — mostrar `git status` antes de commitear)
       y luego: git commit -m "<mensaje sugerido>"
   - Si [E]: pedir el mensaje editado, luego ejecutar commit
   - Si [N]: continuar sin commit, pero advertir:
       "⚠️ Los cambios no están en git — si se rompen, hay que
        revertir manualmente."

5. Después del commit: DETENERSE. No hacer push. Ver la regla de
   despliegue más abajo.

## Regla de despliegue (CRÍTICA — leer antes de dar algo por desplegado)

**Producción es `origin/master`, no esta carpeta.** La cadena completa:

    commit local  →  push de Sebastián (Sleyton) desde su clon  →  deploy/traspaso/desplegar-vps.sh en el VPS

Ese script corre EN EL VPS desde `/opt/danacorp`: `git fetch` + actualizar
master (sin build), `npm ci`, restart del servicio, y espera hasta 90 s a que
`/api/health` devuelva 200.

> **Un commit local sin el push de Sebastián NO está desplegado.**
> Nunca dar por publicado un cambio por haberlo commiteado. Cuando haga falta
> saberlo con certeza, el `fetch` es parte del procedimiento y no un paso
> implícito: `git log origin/master` a secas muestra el último estado
> **traído**, así que sin fetch un commit ya pusheado puede no aparecer y uno
> viejo puede parecer vigente. El repo es público, así que el fetch de lectura
> no pide credenciales:
>
>     git fetch origin && git branch -r --contains <hash> | grep origin/master

Consecuencias:

- **El working tree NO es producción.** Cambiar de rama acá ya no expone nada
  al despliegue, y por ese motivo la regla del worktree separado deja de ser
  necesaria. Pero `master` es exactamente lo que se pushea, así que tiene que
  quedar siempre publicable: **typecheck (web + server) y suite completa en
  verde antes de commitear.** Y el working tree sigue siendo el único lugar
  donde existe lo que todavía no se pusheó — con esta carpeta sincronizando
  por OneDrive.
- **El push ES el mecanismo de release**, no un respaldo. Que lo ejecute
  Sebastián y no Nicholas no cambia su función.
- **Claude no pushea.** No es una política: el push HTTPS pide autenticación
  interactiva por Git Credential Manager y no se puede completar de forma no
  interactiva desde acá.
- **`npm run build` ANTES de commitear, siempre que se toque el frontend.**
  `dist/` está versionado y `desplegar-vps.sh` **no compila**: despliega el
  `dist/` tal como venga en el commit, así que el que viaja tiene que ser
  posterior a la última edición de fuente.
  El porqué es verificable, no un pedido de fe: el script trae un guard que
  revisa que el `dist/` desplegado contenga marcadores de texto del rediseño
  de Resumen y Performance, y **aborta** si detecta un build viejo. Nació de
  un incidente real — el VPS sirviendo un build del 31-07-2026 con el código
  nuevo ya commiteado. Un `dist/` desfasado no rompe nada visible: deja el
  frontend viejo en producción con el código nuevo en git, que es un debug
  ciego.

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
