# DanaCorp

Gestión inmobiliaria (cotizaciones, unidades, clientes, descuentos). Frontend React + Vite,
backend Express + PostgreSQL.

## Requisitos

- Node.js **>= 22** (ver `.nvmrc`)
- PostgreSQL (probado en 16)

## Desarrollo local

```bash
npm install
cp .env.example .env        # completar JWT_SECRET y la conexión PG (PGHOST/PGUSER/PGPASSWORD/PGDATABASE)
npm run migrate             # crea esquema, siembra usuarios y (opcional) migra datos desde danacorp.db
npm run dev:full            # levanta backend (3001) + frontend Vite (3000)
```

- `npm run server` — solo el backend (con recarga)
- `npm test` — tests de integración (usan la base `danacorp_test`)
- `npm run typecheck` — chequeo de tipos del servidor (strict)

## Variables de entorno

Ver `.env.example`. Claves principales: `JWT_SECRET` (obligatorio), `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`
(o `DATABASE_URL`), `FRONTEND_URL`, `UPLOADS_DIR`, `NODE_ENV`, `GEMINI_API_KEY` (opcional, solo backend).

## Esquema y datos

- Esquema PostgreSQL: [`scripts/schema.sql`](scripts/schema.sql) (idempotente).
- `npm run migrate` ([`scripts/migrate-sqlite-to-pg.ts`](scripts/migrate-sqlite-to-pg.ts)): aplica el esquema,
  siembra los 5 usuarios con hash bcrypt ([`scripts/seed-users.ts`](scripts/seed-users.ts)) y copia los datos
  desde `danacorp.db` (si está presente). Idempotente: se puede re-ejecutar.

> ⚠️ Las contraseñas iniciales de los usuarios sembrados (admin123, etc.) **deben rotarse** tras el primer login.

## Despliegue en el VPS

1. **Crear la base** (una vez), como usuario con permiso `CREATEDB`:
   ```sql
   CREATE DATABASE danacorp;
   ```
2. **Código y dependencias** en `/opt/danacorp`:
   ```bash
   npm ci
   cp .env.example .env   # completar valores de producción (NODE_ENV=production, dominio, conexión PG)
   ```
3. **Migrar esquema + datos** (desde una máquina con `danacorp.db`, apuntando `PG*` al VPS):
   ```bash
   npm run migrate
   ```
4. **Build del frontend** (Express lo sirve same-origin desde `dist/`):
   ```bash
   npm run build
   ```
5. **Proceso** con systemd (reinicio automático, instancia única):
   - copiar [`deploy/danacorp.service`](deploy/danacorp.service) a `/etc/systemd/system/`, ajustar rutas/usuario
   - `sudo systemctl daemon-reload && sudo systemctl enable --now danacorp`
6. **HTTPS + reverse proxy** con Caddy:
   - copiar [`deploy/Caddyfile`](deploy/Caddyfile), ajustar el dominio → `systemctl reload caddy`
   - Caddy termina TLS y proxia todo a `localhost:3001` (el backend sirve API + frontend).
7. **Backups** diarios:
   - programar [`deploy/backup.sh`](deploy/backup.sh) por cron (`pg_dump` + tar de `UPLOADS_DIR`).
8. **Healthcheck**: `GET /api/health` responde 200 si PostgreSQL está accesible.

## Notas de seguridad

- Autenticación: JWT (HS256, 8h) + contraseñas con bcrypt en la tabla `users`.
- `helmet`, rate-limit en login, CORS restringido a `FRONTEND_URL` en producción.
- La API key de Gemini vive solo en el backend (no se incluye en el bundle).
- Pendientes recomendados (no bloqueantes): cookies httpOnly + refresh de JWT, validación de
  entrada con zod, CI/lint. Ver el plan de migración para el detalle.
