# Traspaso a GitHub — para quien tenga acceso push a `sleyton24/danacorp`

Escrito el 2026-08-04, actualizado el 2026-08-05. La máquina donde se desarrolla no
puede autenticarse contra GitHub (el Git Credential Manager pide un diálogo
interactivo), así que el push lo tiene que hacer alguien con su propia cuenta. Este
documento es todo lo que hace falta.

## Vía recomendada: correr el script

No hace falta seguir los pasos a mano. [`deploy/traspaso/push-a-github.sh`](../deploy/traspaso/push-a-github.sh)
hace todo el traspaso, en orden, verificando en cada paso y abortando si algo no
cuadra. Desde tu propio clon de `sleyton24/danacorp`, en Git Bash o Linux:

```bash
./push-a-github.sh /ruta/al/danacorp-master-20260805.bundle
```

El script viaja **dentro del bundle**, así que también te lo pueden pasar suelto junto
al `.bundle`. Verifica el bundle, comprueba que el tip es el esperado y que trae el
build nuevo, comprueba que `origin/master` no se movió, empuja el tag de respaldo,
publica con `--force-with-lease` y al final ofrece sincronizar tu master local
(pidiendo confirmación antes del `reset --hard`).

Para desplegar después en el VPS: [`deploy/traspaso/desplegar-vps.sh`](../deploy/traspaso/desplegar-vps.sh).

El resto de este documento explica **por qué** se hace así y deja los comandos
manuales como referencia, por si el script falla o hay que hacer algo distinto.

## Estado actual

| | |
|---|---|
| `master` local | al día, working tree limpio (el tip es el que trae el bundle) |
| `origin/master` en GitHub | `49568ca` — del **2026-07-14** |
| divergencia | **más de 40 commits adelante, 29 atrás** |
| ancestro común | `a51b1a8` (2026-06-22) |

`master` local pasa typecheck (servidor y web) y la suite completa: 16 archivos,
276 tests.

## La trampa: las historias divergieron

Un `git push` normal va a ser **rechazado por non-fast-forward**. No es que falten
cambios: es que las dos historias se separaron en `a51b1a8`.

Los 29 commits que están solo en GitHub son **duplicados título por título** de 29 de
los 44 locales (mismo "Bloque E", mismo "Fix: 4.1 - columna activo", etc., con hashes
distintos). Alguien recommiteó la misma historia desde otra copia.

Verificado antes de escribir esto:

- **GitHub no tiene ni un archivo que no esté en `master` local.**
- Las diferencias de contenido a favor de GitHub son las versiones *viejas* de archivos
  que localmente están más nuevos (`SummaryDashboard.tsx`, `SalesPerformanceView.tsx`,
  `UnitDetail.tsx`, `server.ts`).

Conclusión: **sobrescribir `origin/master` con el local no pierde trabajo.** Hacer
`merge` en cambio deja 29 commits duplicados y conflictos garantizados en esos cuatro
archivos, con riesgo de resucitar código viejo.

## Cómo subirlo

Los commits viajan en un bundle, porque esta carpeta no es alcanzable desde otra máquina:

    ../danacorp-master-20260805.bundle    (historia completa, verificado por clon)

Está un nivel arriba de la carpeta del proyecto, en la misma carpeta de OneDrive.

> Los comandos de esta sección son la referencia manual. Lo normal es correr
> [`deploy/traspaso/push-a-github.sh`](../deploy/traspaso/push-a-github.sh), que los
> ejecuta en este mismo orden con las verificaciones puestas.

### 1. Traer los commits al clon propio

```bash
git remote add traspaso /ruta/al/danacorp-master-20260805.bundle
git fetch traspaso 'refs/heads/*:refs/remotes/traspaso/*'
git bundle list-heads /ruta/al/danacorp-master-20260805.bundle | grep 'refs/heads/master$'
git log --oneline traspaso/master -5      # el tip debe coincidir con la línea de arriba
```

El refspec va a `refs/remotes/`, no a `refs/heads/`: traerlos como ramas locales choca
con cualquier rama que se llame `traspaso` y falla con «cannot lock ref».

### 2. Preservar la historia vieja de GitHub (recomendado, es gratis)

El tag hay que **crearlo desde tu propio `origin/master`**, no esperar que venga en el
bundle. Por dos razones:

1. El refspec del paso 1 es `refs/heads/*`: no pide tags. Puede que el tag llegue igual
   —git arrastra por su cuenta los tags que apuntan a objetos que acaba de bajar—, pero
   no está garantizado. Si no llega, `git push origin origin-master-antes-de-20260804`
   a secas falla con «src refspec ... does not match any».
2. Aunque llegue, ese tag apunta a lo que era `origin/master` **en la máquina de
   desarrollo el 2026-08-04**. Lo que interesa respaldar es lo que está por sobrescribirse
   en GitHub *ahora*. Crearlo desde tu `origin/master` recién fetcheado etiqueta
   exactamente eso.

```bash
git fetch origin
git rev-parse origin/master     # tiene que dar 49568ca...; si no, pará y revisá
git tag -f origin-master-antes-de-20260804 origin/master
git push origin refs/tags/origin-master-antes-de-20260804
```

Con eso los 29 commits viejos quedan alcanzables para siempre, aunque master se
sobrescriba.

### 3. Publicar

```bash
git push --force-with-lease origin traspaso/master:master
```

`--force-with-lease` aborta si alguien pusheó a GitHub mientras tanto, en vez de
pisarlo. Si aborta, no forzar a ciegas: revisar qué entró primero.

Después de esto, cualquier otra copia del repo (por ejemplo la que vivía en
`C:\Users\nhorn\Downloads\danacorp-project`) queda desincronizada y necesita
`git fetch && git reset --hard origin/master`, o reclonar.

## Después del push: desplegar en el VPS

`dist/` ahora **está versionado** (ver [`.gitignore`](../.gitignore)), así que el pull
trae la interfaz compilada y no hace falta compilar en el servidor:

```bash
cd /opt/danacorp
./deploy/traspaso/desplegar-vps.sh
```

El script hace lo de abajo, más el health check con reintentos y la verificación de que
el `dist/` desplegado es el nuevo:

```bash
cd /opt/danacorp
git pull                        # ver el aviso de abajo: la primera vez no alcanza
npm ci                          # package-lock.json está versionado
sudo systemctl restart danacorp
```

**La primera vez, `git pull` a secas no sirve.** `origin/master` se reescribió con
`--force-with-lease`, así que el HEAD del VPS ya no es ancestro del nuevo y el pull
intenta un merge con conflictos. Va `git fetch origin && git reset --hard origin/master`
(no toca `.env`, `uploads/` ni `node_modules/`, que no están versionados).

Y **nunca** `npm run build` en el servidor: el build sale del repo.

Lo que **no** viene en el repo y tiene que existir en el servidor:

- `.env` — tiene secretos, nunca se versiona. Se arma desde
  [`.env.example`](../.env.example).
- `uploads/` — datos de clientes, es un volumen persistente. Lo respalda
  [`deploy/backup.sh`](../deploy/backup.sh).
- `node_modules/` — sale de `npm ci`.

Verificación final: `GET /api/health` responde 200, y en la app la pestaña **Resumen**
tiene que mostrar los controles nuevos ("Comparar contra", "Colocado en el período").
Si no aparecen, el `dist/` desplegado es viejo.

## Regla permanente

Quien cambie el frontend corre `npm run build` **antes de commitear**. Si no, el fuente
queda al día pero se despliega la interfaz vieja — que es exactamente el problema que
hizo falta arreglar acá: el build publicado era del 31-07 y no tenía el rediseño de
Resumen y Performance, aunque el código estuviera commiteado desde el 03-08.
