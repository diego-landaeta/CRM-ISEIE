---
name: Deploy staging con PM2 (no manual nohup)
description: PM2 gestiona crm-api-staging; usar pm2 restart, nunca kill + nohup (conflicto EADDRINUSE)
type: feedback
originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---
En el servidor 187.124.128.126 el backend corre via PM2 (user `claude`, app name `crm-api-staging`).

**Regla:** para reiniciar el backend tras deploy, usar siempre:
```bash
su - claude -c 'export PATH=/home/claude/.nvm/versions/node/v24.14.1/bin:$PATH && pm2 restart crm-api-staging'
```

NO usar `kill -9 PID` ni `nohup node ...` manualmente. PM2 auto-respawn y ambos procesos pelean por el puerto 3002 → EADDRINUSE y estado inconsistente.

**Why:** Se gasto media hora de sesion 2026-04-24 debugueando servers duplicados. PID 2727 era hijo de PM2 God Daemon (967), y mi `nohup` lanzaba otro que crasheaba. Lesson: siempre via PM2.

**How to apply:**
- `pm2 list` para ver estado y restart counter
- `pm2 logs crm-api-staging --lines 30 --nostream --err` para errores
- `pm2 logs crm-api-staging --lines 30 --nostream --out` para stdout (los logs Pino van aqui)
- `pm2 restart crm-api-staging` tras cualquier cambio de backend

El logs path: `/home/claude/.pm2/logs/crm-api-staging-{out,error}.log`.

**Deploy tipico completo:**
```bash
cd backend && tar -czf /tmp/backend.tgz --exclude=node_modules --exclude=tests src migrations package.json
scp /tmp/backend.tgz root@187.124.128.126:/tmp/
ssh root@187.124.128.126 "cd /opt/crm/staging && tar -xzf /tmp/backend.tgz && chown -R claude:claude src migrations && su - claude -c 'export PATH=/home/claude/.nvm/versions/node/v24.14.1/bin:\$PATH && pm2 restart crm-api-staging'"
```
