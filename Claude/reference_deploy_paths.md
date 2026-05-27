---
name: Rutas de deploy staging VPS
description: Paths exactos donde nginx sirve frontend/backend en staging para evitar deploys a directorios fantasma
type: reference
originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---
VPS Hostinger 187.124.128.126, staging URL https://crm-test.iseie.com/testeo_crm/

## Rutas correctas (las que nginx realmente lee)

- **Frontend SPA**: `/var/www/crm/staging/frontend/` (NO `/var/www/testeo_crm/`)
  - nginx alias: `location /testeo_crm { alias /var/www/crm/staging/frontend; }`
  - owner: `claude:claude`
- **Backend API**: `/opt/crm/staging/` con PM2 app `crm-api-staging` (puerto 3002)
  - nginx proxy: `/testeo_crm/api -> localhost:3002/api`
  - PM2 corre como user `claude`, restart con `sudo -u claude bash -lc 'export PATH=/home/claude/.nvm/versions/node/v24.14.1/bin:$PATH && pm2 restart crm-api-staging --update-env'`

## Build frontend

`MSYS_NO_PATHCONV=1 npx vite build --base=/testeo_crm/` desde Git Bash en Windows. Sin el env var, MSYS convierte `/testeo_crm/` a `C:\Program Files\Git\testeo_crm\` y rompe todas las rutas en index.html.

## Why
Sesion 2026-04-25: durante varias horas deployé a `/var/www/testeo_crm/` (path inexistente para nginx). El usuario veia el bundle cacheado viejo aunque borrara cache, porque nginx servia desde otra ruta. La pista que delato el bug: `cat /etc/nginx/sites-enabled/* | grep testeo_crm` mostro `alias /var/www/crm/staging/frontend`.

## How to apply
Antes de cualquier deploy de staging:
1. Confirmar destino con `cat /etc/nginx/sites-enabled/*` o usar siempre `/var/www/crm/staging/frontend/`
2. Build con `MSYS_NO_PATHCONV=1` para evitar mangling de rutas
3. Verificar despues del deploy: `curl -s https://crm-test.iseie.com/testeo_crm/ | grep -oE 'index-[^\"]+'`
