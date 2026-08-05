#!/usr/bin/env bash
# Publica en GitHub (sleyton24/danacorp) la historia que viaja en el bundle de
# traspaso, sobrescribiendo origin/master.
#
# Se corre desde TU PROPIO clon de https://github.com/sleyton24/danacorp,
# en Git Bash (Windows) o en cualquier Linux/macOS:
#
#     ./push-a-github.sh /ruta/al/danacorp-master-20260805.bundle
#
# Contexto (el detalle está en docs/traspaso-a-github.md, dentro del bundle):
# las dos historias divergieron en a51b1a8. Los 29 commits que hoy están en
# GitHub son duplicados título por título de commits locales, con hashes
# distintos, y ninguno aporta un archivo que el bundle no traiga. Por eso se
# sobrescribe en vez de mergear: mergear deja 29 duplicados y resucita código
# viejo en SummaryDashboard.tsx, SalesPerformanceView.tsx, UnitDetail.tsx y
# server.ts.
#
# El script no borra nada sin respaldo: antes de pisar master empuja el tag
# origin-master-antes-de-20260804, así los 29 commits viejos quedan
# alcanzables para siempre.

set -euo pipefail

# ── Qué se espera encontrar ───────────────────────────────────────────────────

# Hash del PADRE del tip que trae el bundle.
#
# Por qué el padre y no el tip: este archivo viaja dentro del propio commit que
# forma el tip, y un commit no puede contener su propio hash. El padre sí es un
# valor fijo y verificable. El tip queda pinneado igual, porque además se exige
# que sea exactamente un commit por encima del padre y que su árbol traiga el
# build nuevo (ver VERIFICACIÓN DE CONTENIDO más abajo).
TIP_PADRE_ESPERADO="__PENDIENTE__"

# Tip actual de GitHub al momento de preparar el traspaso (2026-07-14).
# Si origin/master ya no es esto, alguien pusheó después y hay que revisar a mano.
ORIGIN_MASTER_ESPERADO="49568ca2117a9d66669b65707f6c60f2db594bbe"

TAG_RESPALDO="origin-master-antes-de-20260804"
REMOTO="traspaso"

# Textos del rediseño de Resumen y Performance. Si el dist/ del bundle no los
# tiene, el bundle es viejo y desplegarlo publica la interfaz anterior.
MARCADORES=(
  "Comparar contra"
  "Colocado en el período"
  "Sin colocaciones"
  "Colocación por tipología"
)

# ── Utilidades ────────────────────────────────────────────────────────────────

paso()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
error() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; }

abortar() {
  error "$1"
  shift
  for linea in "$@"; do printf '       %s\n' "$linea" >&2; done
  exit 1
}

# ── 0. Argumentos y contexto ──────────────────────────────────────────────────

if [ $# -ne 1 ]; then
  echo "Uso: $0 /ruta/al/danacorp-master-<fecha>.bundle" >&2
  exit 2
fi

BUNDLE="$1"

if [ "$TIP_PADRE_ESPERADO" = "__PENDIENTE__" ]; then
  abortar "Este script quedó sin completar: TIP_PADRE_ESPERADO sigue en __PENDIENTE__." \
          "Es una copia intermedia. Pedí la versión definitiva antes de pushear nada."
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  abortar "No estás dentro de un repositorio git." \
          "Corré este script desde tu clon de https://github.com/sleyton24/danacorp."
fi

if [ ! -f "$BUNDLE" ]; then
  abortar "No existe el archivo de bundle: $BUNDLE"
fi

BUNDLE="$(cd "$(dirname "$BUNDLE")" && pwd)/$(basename "$BUNDLE")"

paso "Lo que va a hacer este script"
cat <<RESUMEN
    1. Verificar el bundle:            $BUNDLE
    2. Registrar el remoto '$REMOTO' apuntando al bundle y traer sus commits
       a refs/remotes/$REMOTO/*
    3. Comprobar que $REMOTO/master es el tip esperado y que trae el build nuevo
    4. git fetch origin y comprobar que origin/master sigue siendo
       ${ORIGIN_MASTER_ESPERADO:0:7} (si no, aborta)
    5. Crear y pushear el tag de respaldo '$TAG_RESPALDO'
       desde TU origin/master
    6. git push --force-with-lease origin $REMOTO/master:master
    7. Dejar tu master local al día (pide confirmación antes del reset --hard)

    Hasta el paso 5 no se escribe nada en GitHub.
RESUMEN

# ── 1. Verificar el bundle ────────────────────────────────────────────────────

paso "1. Verificando el bundle"
info "Archivo: $BUNDLE"
if ! git bundle verify "$BUNDLE"; then
  abortar "'git bundle verify' falló." \
          "El archivo está corrupto o incompleto (¿se copió entero?)." \
          "No sigas: no hay nada que pushear."
fi

# ── 2. Registrar el remoto y traer los commits ────────────────────────────────

paso "2. Registrando el remoto '$REMOTO' y trayendo los commits"
if git remote get-url "$REMOTO" >/dev/null 2>&1; then
  info "El remoto '$REMOTO' ya existía; se actualiza su URL."
  git remote set-url "$REMOTO" "$BUNDLE"
else
  info "Creando el remoto '$REMOTO'."
  git remote add "$REMOTO" "$BUNDLE"
fi

# refs/remotes y no refs/heads: si se trajeran a refs/heads/traspaso/* chocarían
# con cualquier rama local llamada 'traspaso' ("cannot lock ref").
git fetch "$REMOTO" 'refs/heads/*:refs/remotes/'"$REMOTO"'/*'

# ── 3. Comprobar que el tip es el esperado ────────────────────────────────────

paso "3. Comprobando el tip del bundle"

if ! TIP="$(git rev-parse --verify "$REMOTO/master^{commit}" 2>/dev/null)"; then
  abortar "El bundle no trae una rama 'master'." \
          "Revisá qué trae con: git bundle list-heads \"$BUNDLE\""
fi

if ! TIP_PADRE="$(git rev-parse --verify "$REMOTO/master^^{commit}" 2>/dev/null)"; then
  abortar "El tip del bundle no tiene un commit padre alcanzable." \
          "El bundle está truncado. No sigas."
fi

info "tip     : $TIP  $(git log -1 --format=%s "$TIP")"
info "padre   : $TIP_PADRE  $(git log -1 --format=%s "$TIP_PADRE")"
info "esperado: $TIP_PADRE_ESPERADO (padre)"

if [ "$TIP_PADRE" != "$TIP_PADRE_ESPERADO" ]; then
  abortar "El padre del tip del bundle no es el esperado." \
          "esperado: $TIP_PADRE_ESPERADO" \
          "recibido: $TIP_PADRE" \
          "Este bundle no es el que preparó este script. No pushees nada."
fi

# El tip tiene que ser exactamente un commit por encima del padre pinneado.
DISTANCIA="$(git rev-list --count "$TIP_PADRE..$TIP")"
if [ "$DISTANCIA" != "1" ]; then
  abortar "El tip está a $DISTANCIA commits del padre esperado, no a 1." \
          "El bundle trae commits que este script no conoce. Revisá a mano:" \
          "  git log --oneline $TIP_PADRE..$TIP"
fi

# VERIFICACIÓN DE CONTENIDO: el dist/ del bundle tiene que ser el build nuevo.
# dist/ está versionado a propósito; el VPS no compila, despliega este build.
paso "3b. Comprobando que el bundle trae el build nuevo (dist/)"
ASSETS="$(git ls-tree -r --name-only "$TIP" -- dist/assets | grep '\.js$' || true)"
if [ -z "$ASSETS" ]; then
  abortar "El bundle no trae dist/assets/*.js." \
          "dist/ tiene que venir versionado: el VPS no compila."
fi

for marcador in "${MARCADORES[@]}"; do
  encontrado=0
  for asset in $ASSETS; do
    if git show "$TIP:$asset" | grep -qF "$marcador"; then
      encontrado=1
      break
    fi
  done
  if [ "$encontrado" -eq 1 ]; then
    info "OK  · \"$marcador\""
  else
    abortar "El dist/ del bundle no contiene \"$marcador\"." \
            "Es un build viejo, anterior al rediseño de Resumen y Performance." \
            "Desplegarlo publicaría la interfaz anterior. No pushees."
  fi
done

# ── 4. Comprobar el estado de GitHub ──────────────────────────────────────────

paso "4. Comprobando el estado de origin (GitHub)"
git fetch origin
ORIGIN_MASTER="$(git rev-parse --verify origin/master)"
info "origin/master: $ORIGIN_MASTER"
info "esperado     : $ORIGIN_MASTER_ESPERADO"

if [ "$ORIGIN_MASTER" != "$ORIGIN_MASTER_ESPERADO" ]; then
  abortar "origin/master ya no es el commit que se analizó al preparar el traspaso." \
          "esperado: $ORIGIN_MASTER_ESPERADO" \
          "actual  : $ORIGIN_MASTER" \
          "Alguien pusheó después del 2026-07-14. El análisis que justifica" \
          "sobrescribir master (los 29 commits de GitHub son duplicados) puede" \
          "haber dejado de ser cierto. Revisá a mano qué entró:" \
          "  git log --oneline $ORIGIN_MASTER_ESPERADO..origin/master"
fi

# ── 5. Respaldo: tag sobre la historia vieja de GitHub ────────────────────────

paso "5. Respaldando la historia vieja de GitHub con el tag '$TAG_RESPALDO'"
# El tag se crea desde TU origin/master, no desde el bundle. El refspec del
# paso 2 (refs/heads/*) no pide tags; git puede arrastrarlos igual si apuntan a
# objetos que bajó, pero no está garantizado. Y aunque el tag del bundle llegue,
# apunta a lo que era origin/master en la máquina de desarrollo el 2026-08-04.
# Lo que hay que respaldar es lo que está por sobrescribirse acá y ahora, así
# que -f sobre el origin/master recién fetcheado es lo correcto en los dos casos.
info "Etiquetando $ORIGIN_MASTER (tu origin/master) como '$TAG_RESPALDO'."
git tag -f "$TAG_RESPALDO" origin/master
git push origin "refs/tags/$TAG_RESPALDO"
info "Tag publicado. Los 29 commits viejos quedan alcanzables para siempre."

# ── 6. Publicar ───────────────────────────────────────────────────────────────

paso "6. Publicando: git push --force-with-lease origin $REMOTO/master:master"
if ! git push --force-with-lease origin "$REMOTO/master:master"; then
  abortar "El push con --force-with-lease fue rechazado." \
          "" \
          "NO fuerces a ciegas: NO corras 'git push --force' ni '--force-with-lease'" \
          "con un lease inventado. El rechazo significa que origin/master se movió" \
          "entre el fetch del paso 4 y este push — hay trabajo de otra persona en" \
          "juego y pisarlo lo destruye." \
          "" \
          "Qué hacer: volvé a correr este script desde cero. Si vuelve a fallar en" \
          "el paso 4, revisá con calma qué se pusheó y consultá antes de seguir." \
          "" \
          "La historia vieja quedó a salvo en el tag '$TAG_RESPALDO'."
fi
info "origin/master ahora apunta a $TIP."

# ── 7. Dejar el master local al día ───────────────────────────────────────────

paso "7. Sincronizando tu master local"
git checkout master
git fetch origin

LOCAL_MASTER="$(git rev-parse --verify master)"
if [ "$LOCAL_MASTER" = "$TIP" ]; then
  info "Tu master local ya está en $TIP. No hace falta tocar nada."
  paso "Listo. El traspaso terminó bien."
  exit 0
fi

cat <<AVISO

    Tu master local está en $LOCAL_MASTER
    y origin/master quedó en $TIP.

    El siguiente paso es:

        git reset --hard origin/master

    Eso DESCARTA cualquier commit local de master que no esté en GitHub y
    cualquier cambio sin commitear. Los commits descartados solo se recuperan
    por 'git reflog'.
AVISO

printf '\n    ¿Correr el reset --hard? [s/N]: '
read -r RESPUESTA
case "$RESPUESTA" in
  s|S|si|Si|SI|sí|Sí|SÍ)
    git reset --hard origin/master
    info "master local en $(git rev-parse HEAD)."
    ;;
  *)
    info "Reset omitido. Tu master local queda como estaba."
    info "El push a GitHub ya se hizo igual: eso no se revierte por saltear este paso."
    ;;
esac

paso "Listo. El traspaso terminó bien."
