#!/usr/bin/env bash
# Despliegue de DanaCorp en el VPS. Se corre EN EL VPS, desde /opt/danacorp:
#
#     cd /opt/danacorp && ./deploy/traspaso/desplegar-vps.sh
#
# NO corre 'npm run build'. Ese es el cambio de fondo de este traspaso: dist/
# está versionado en el repo y se despliega tal cual lo emitió vite en la
# máquina de desarrollo. Compilar acá volvería a abrir la puerta al problema que
# hubo que arreglar (el VPS servía un build del 31-07 sin el rediseño de Resumen
# y Performance, aunque el código estuviera commiteado).
#
# Quien cambie el frontend corre 'npm run build' ANTES de commitear, en su
# máquina. Acá no.
#
# Lo que NO viene del repo y tiene que existir ya en el servidor:
#   .env           — secretos. Nunca se versiona; se arma desde .env.example.
#   uploads/       — datos de clientes, volumen persistente. Lo respalda
#                    deploy/backup.sh. Un despliegue no lo toca.
#   node_modules/  — lo reconstruye 'npm ci' desde package-lock.json.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/danacorp}"
SERVICIO="${SERVICIO:-danacorp}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"   # segundos totales de espera
HEALTH_INTERVALO="${HEALTH_INTERVALO:-2}" # segundos entre reintentos

# Textos del rediseño de Resumen y Performance. Si el dist/ desplegado no los
# tiene, se está sirviendo un build viejo.
MARCADORES=(
  "Comparar contra"
  "Colocado en el período"
  "Sin colocaciones"
  "Colocación por tipología"
)

paso()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
error() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; }

abortar() {
  error "$1"
  shift
  for linea in "$@"; do printf '       %s\n' "$linea" >&2; done
  exit 1
}

cd "$REPO_DIR"

paso "Lo que va a hacer este script"
cat <<RESUMEN
    Repo      : $REPO_DIR
    Servicio  : $SERVICIO
    Health    : $HEALTH_URL

    1. git fetch + actualizar master (sin build)
    2. npm ci
    3. sudo systemctl restart $SERVICIO
    4. Esperar a que $HEALTH_URL devuelva 200 (hasta ${HEALTH_TIMEOUT}s)
    5. Verificar que el dist/ desplegado es el nuevo
RESUMEN

# ── 1. Traer el código ────────────────────────────────────────────────────────

paso "1. Actualizando el repositorio"
ANTES="$(git rev-parse HEAD)"
info "HEAD actual: $ANTES"

git fetch origin

# 'git pull' a secas no sirve la primera vez después del traspaso: origin/master
# fue reescrito con --force-with-lease, así que el HEAD viejo del VPS ya no es
# ancestro del nuevo y el pull intentaría un merge con conflictos garantizados.
if git merge-base --is-ancestor HEAD origin/master; then
  git pull --ff-only origin master
else
  cat <<AVISO

    El HEAD del VPS no es ancestro de origin/master: la historia remota fue
    reescrita (esto es lo esperado en el primer despliegue después del
    traspaso a GitHub).

    Un 'git pull' normal acá haría un merge con conflictos. Lo correcto es:

        git reset --hard origin/master

    Eso DESCARTA cualquier commit o cambio local en $REPO_DIR.
    No toca .env, uploads/ ni node_modules/ (no están versionados).
AVISO
  printf '\n    ¿Correr el reset --hard? [s/N]: '
  read -r RESPUESTA
  case "$RESPUESTA" in
    s|S|si|Si|SI|sí|Sí|SÍ) git reset --hard origin/master ;;
    *) abortar "Despliegue cancelado: el repo quedó sin actualizar." ;;
  esac
fi

DESPUES="$(git rev-parse HEAD)"
info "HEAD nuevo : $DESPUES  $(git log -1 --format=%s)"
if [ "$ANTES" = "$DESPUES" ]; then
  info "(el repo ya estaba al día; se reinstala y reinicia igual)"
fi

# ── 2. Dependencias ───────────────────────────────────────────────────────────

paso "2. Instalando dependencias (npm ci)"
info "npm ci reconstruye node_modules/ exacto según package-lock.json."
npm ci

# NADA de 'npm run build' acá. Ver la cabecera del script.

# ── 3. Reiniciar ──────────────────────────────────────────────────────────────

paso "3. Reiniciando el servicio '$SERVICIO'"
sudo systemctl restart "$SERVICIO"

# ── 4. Esperar el health check ────────────────────────────────────────────────

paso "4. Esperando a que $HEALTH_URL responda 200"
info "Hasta ${HEALTH_TIMEOUT}s, reintentando cada ${HEALTH_INTERVALO}s."

TRANSCURRIDO=0
CODIGO=""
while [ "$TRANSCURRIDO" -lt "$HEALTH_TIMEOUT" ]; do
  CODIGO="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
  if [ "$CODIGO" = "200" ]; then
    info "OK · 200 después de ${TRANSCURRIDO}s."
    break
  fi
  sleep "$HEALTH_INTERVALO"
  TRANSCURRIDO=$((TRANSCURRIDO + HEALTH_INTERVALO))
  printf '    ... %ss (última respuesta: %s)\n' "$TRANSCURRIDO" "${CODIGO:-sin respuesta}"
done

if [ "$CODIGO" != "200" ]; then
  error "El backend no respondió 200 en ${HEALTH_TIMEOUT}s (última: ${CODIGO:-sin respuesta})."
  printf '       Últimas líneas del log:\n' >&2
  sudo journalctl -u "$SERVICIO" -n 40 --no-pager >&2 || true
  abortar "Despliegue fallido: el servicio no levantó." \
          "Revisá: sudo journalctl -u $SERVICIO -f"
fi

# ── 5. Verificar que el dist/ desplegado es el nuevo ──────────────────────────

paso "5. Verificando el dist/ desplegado"

shopt -s nullglob
ASSETS=(dist/assets/*.js)
shopt -u nullglob

if [ "${#ASSETS[@]}" -eq 0 ]; then
  abortar "No hay dist/assets/*.js en $REPO_DIR." \
          "dist/ tiene que venir versionado en el repo: acá no se compila."
fi

FALTANTES=()
for marcador in "${MARCADORES[@]}"; do
  if grep -qF -- "$marcador" "${ASSETS[@]}"; then
    info "OK  · \"$marcador\""
  else
    info "NO  · \"$marcador\""
    FALTANTES+=("$marcador")
  fi
done

if [ "${#FALTANTES[@]}" -gt 0 ]; then
  abortar "El build desplegado es VIEJO: faltan ${#FALTANTES[@]} de ${#MARCADORES[@]} textos del rediseño." \
          "El backend está corriendo, pero la interfaz servida es la anterior al" \
          "rediseño de Resumen y Performance." \
          "Causa probable: se commiteó el fuente sin correr 'npm run build' antes." \
          "Se arregla en la máquina de desarrollo (build + commit + push), no acá."
fi

paso "Despliegue OK"
info "commit  : $DESPUES"
info "health  : 200"
info "dist/   : ${#MARCADORES[@]}/${#MARCADORES[@]} textos del rediseño presentes"
