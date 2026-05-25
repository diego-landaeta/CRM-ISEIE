# 02 — Setup local

Pasos para tener CRM-ISEIE corriendo en tu máquina con login funcional.

---

## 0. Pre-requisitos

- Node 20+
- npm 10+
- PostgreSQL 15+ accesible **desde tu máquina**. Tres opciones:
  - **a)** Postgres nativo en Windows (instalador EnterpriseDB).
  - **b)** Postgres en Docker Desktop (`docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=… postgres:15`).
  - **c)** Túnel SSH al VPS una vez que ahí esté instalado: `ssh -L 5432:127.0.0.1:5432 root@72.60.90.135`.

Mientras no esté decidida la opción, este doc asume puerto local `5432` y credenciales `crm_iseie_user / <pass>` sobre la DB `crm_iseie`.

---

## 1. Variables de entorno

```powershell
cd backend
Copy-Item .env.example .env
```

Edita `.env` y deja al menos:

```
DATABASE_URL=postgresql://crm_iseie_user:<pass>@localhost:5432/crm_iseie
JWT_SECRET=<32-64 chars aleatorios — generar con: openssl rand -hex 32>
COOKIE_SECURE=false
CRM_BASE_URL=http://localhost:5173
```

Frontend no necesita `.env` para arrancar (el proxy de Vite ya apunta a `localhost:3005`).

---

## 2. Crear DB + usuario

Conéctate como superusuario de Postgres y ejecuta:

```sql
CREATE USER crm_iseie_user WITH PASSWORD '<pass>';
CREATE DATABASE crm_iseie OWNER crm_iseie_user;
\c crm_iseie
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- para gen_random_bytes() del seed
```

---

## 3. Aplicar schema

```powershell
psql -U crm_iseie_user -d crm_iseie -h localhost -f backend/migrations/001_initial_schema.sql
```

Debe terminar con `COMMIT` sin errores.

---

## 4. Crear superadmin + primer proyecto

```powershell
cd backend
node scripts/create-superadmin.js --email tu@email.com --nombre "Tu Nombre"
# te pide contraseña dos veces (mínimo 8 chars, 1 mayúscula, 1 número)

psql -U crm_iseie_user -d crm_iseie -h localhost -f seeds/001_first_project.sql

# Asociar superadmin al proyecto:
psql -U crm_iseie_user -d crm_iseie -h localhost -c `
  "INSERT INTO user_projects (user_id, project_id, orden_cola) SELECT u.id, p.id, 0 FROM users u, projects p WHERE u.email = 'tu@email.com' AND p.slug = 'iseie';"
```

---

## 5. Arrancar dev

Dos terminales:

```powershell
# Terminal 1 — backend
cd backend
npm run dev
# → "CRM-ISEIE API corriendo en puerto 3005"
```

```powershell
# Terminal 2 — frontend
cd frontend
npm run dev
# → http://localhost:5173 (o 5174 si 5173 está ocupado)
```

Abre el navegador en `http://localhost:5173`, deberías ver la `LoginPage`. Entra con el email + password del superadmin.

---

## Verificación

```powershell
# Backend vivo
curl http://localhost:3005/api/health
# → {"success":true,"data":{"status":"ok",...}}

# Login funcional
curl -X POST http://localhost:3005/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"tu@email.com","password":"PASSWORD"}'
# → 200 con accessToken + user + projects
```

---

## 6. Dev local contra la DB de producción (recomendado)

Trabajar contra datos reales sin instalar Postgres local. UFW del VPS sólo
acepta conexiones a `5432` desde `localhost`, por eso se hace por túnel SSH.

```powershell
# Terminal 1 — túnel SSH abierto (no escribir nada, déjalo correr)
ssh -N -L 5432:127.0.0.1:5432 root@72.60.90.135
```

Credenciales del VPS: ver `docs/_private/CREDENCIALES.md` (gitignored).

`backend/.env` (sólo cambios respecto a §1):

```
DATABASE_URL=postgresql://crm_iseie_user:<pwd-VPS>@127.0.0.1:5432/crm_iseie
JWT_SECRET=<el mismo que el VPS — copiar desde /opt/crm-iseie/.env vía SSH>
JWT_REFRESH_SECRET=<el mismo que el VPS>
ENCRYPTION_KEY=<el mismo que el VPS — si no, fallarán las credenciales cifradas>
COOKIE_SECURE=false
CORS_ORIGINS=http://localhost:5173
```

Luego como en §5. Login con el superadmin real.

> ⚠️ Estás escribiendo en producción. Para test usa el seed §7 en una DB local distinta, o usa los usuarios `gestor*.@test-seed.iseie.test` (password `Test1234!`) que el seed crea.

---

## 7. Seed de datos de prueba

`backend/seeds/003_test_data.js` siembra 30 leads + productos + conversiones
+ egresos en el proyecto `iseie` (idempotente: si ya hay datos del seed, omite).

```powershell
cd backend

# Sembrar
node seeds/003_test_data.js

# Borrar todo lo que el seed creó (limpio, no afecta datos reales)
node seeds/003_test_data.js --reset
```

Crea automáticamente:

- 2 gestores (`gestor1.iseie@test-seed.iseie.test`,
  `gestor2.iseie@test-seed.iseie.test`), password **`Test1234!`**.
- 6 productos (Máster, Diplomado, Curso).
- ~30 leads repartidos en todos los estados (nuevo, contactado,
  en_seguimiento, convertido…) con interacciones y recordatorios realistas.
- Conversiones de los `convertido`: mezcla de pagadas, parciales y
  pendientes con `conversion_payments` registrados.
- 12 egresos por proyecto en categorías variadas (sueldos, alquiler,
  publicidad, etc.).

> Todos los registros llevan la marca `[seed-test]` en `notas`/`descripcion`,
> así `--reset` los detecta y borra sin tocar nada real.

---

## Troubleshooting

- **"ECONNREFUSED 127.0.0.1:5432"** → Postgres no está corriendo o el túnel SSH no está abierto.
- **"password authentication failed"** → `DATABASE_URL` en `.env` no coincide con el usuario/pass que creaste.
- **"relation \"users\" does not exist"** → no aplicaste la migración 001.
- **Login responde 401** → el password no es el que crees, o el usuario está `active=false`. Verifica con `SELECT email, role, active FROM users;`.
- **CORS error desde el navegador** → revisa `CORS_ORIGINS` en `.env` (debe contener el origin del frontend).
- **Vite en 5174 en vez de 5173** → otro proceso ocupa 5173 (probablemente el CRM hermano corriendo en paralelo). Funciona igual; el proxy se calcula relativo.
