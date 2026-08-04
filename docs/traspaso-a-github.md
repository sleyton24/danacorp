# Traspaso a GitHub — para quien tenga acceso push a `sleyton24/danacorp`

Escrito el 2026-08-04. La máquina donde se desarrolla no puede autenticarse contra
GitHub (el Git Credential Manager pide un diálogo interactivo), así que el push lo
tiene que hacer alguien con su propia cuenta. Este documento es todo lo que hace falta.

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

    ../danacorp-master-20260804.bundle    (3,9 MB, historia completa, verificado)

Está un nivel arriba de la carpeta del proyecto, en la misma carpeta de OneDrive.

### 1. Traer los commits al clon propio

```bash
git remote add traspaso /ruta/al/danacorp-master-20260804.bundle
git fetch traspaso 'refs/heads/*:refs/heads/traspaso/*'
git bundle list-heads /ruta/al/danacorp-master-20260804.bundle | grep 'refs/heads/master$'
git log --oneline traspaso/master -5      # el tip debe coincidir con la línea de arriba
```

### 2. Preservar la historia vieja de GitHub (recomendado, es gratis)

El bundle incluye el tag `origin-master-antes-de-20260804` → `49568ca`, el tip actual
de GitHub. Empujarlo primero deja los 29 commits viejos alcanzables para siempre:

```bash
git push origin origin-master-antes-de-20260804
```

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
git pull
npm ci                          # package-lock.json está versionado
sudo systemctl restart danacorp
```

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
