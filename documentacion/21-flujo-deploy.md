# 21. Flujo de Deploy

## Resumen

Deploy manual via scp + ssh. No hay CI/CD todavia (esta en roadmap).

## Deploy staging

```mermaid
sequenceDiagram
    autonumber
    participant D as Dev (local)
    participant GH as GitHub
    participant VPS as VPS Hostinger

    D->>D: git commit
    D->>GH: git push origin main

    D->>D: cd frontend<br/>npx vite build --base=/testeo_crm/

    D->>D: tar --exclude='node_modules' -czf backend.tar.gz backend/
    D->>D: tar -czf frontend-dist.tar.gz frontend/dist/

    D->>VPS: scp tarballs a /tmp/

    D->>VPS: ssh claude@...
    Note over VPS: En el servidor:
    VPS->>VPS: cp .env /tmp/.env.bak
    VPS->>VPS: tar -xzf backend.tar.gz
    VPS->>VPS: cp .env.bak .env
    VPS->>VPS: npm install --omit=dev (si cambio package.json)

    VPS->>VPS: rm -rf /var/www/crm/staging/frontend/*
    VPS->>VPS: tar -xzf frontend-dist.tar.gz

    VPS->>VPS: pm2 restart crm-api-staging --update-env

    VPS-->>D: 200 OK (health check)
```

## Deploy production (futuro - cuando haya CI)

```mermaid
sequenceDiagram
    participant D as Dev
    participant GH as GitHub
    participant CI as GitHub Actions
    participant VPS as VPS

    D->>GH: Push a tag v1.0.0
    GH->>CI: Trigger workflow
    CI->>CI: Install deps
    CI->>CI: Run tests (73 tests)
    alt Tests fallan
        CI-->>D: Notifica + stop
    end
    CI->>CI: Build frontend prod<br/>npx vite build --base=/crm/
    CI->>CI: Build backend (tarball)
    CI->>VPS: ssh + scp deploy
    VPS->>VPS: Backup DB con pg_dump
    VPS->>VPS: Ejecuta migrations pendientes
    VPS->>VPS: pm2 reload crm-api --update-env
    VPS->>VPS: Smoke test /health
    alt Falla
        VPS->>VPS: Rollback tarball anterior
    end
    CI-->>D: Notifica OK
```

## Comandos actuales

```bash
# 1. Build frontend (en local)
cd "c:/Users/Diego/Desktop/Proyectos-Carlos/CRM ISEIH/frontend"
npx vite build --base=/testeo_crm/   # staging
# o
npx vite build --base=/crm/          # production

# 2. Crear tarballs
cd ..
tar --exclude='node_modules' --exclude='.env' -czf /tmp/backend.tar.gz backend/
tar -czf /tmp/frontend-dist.tar.gz frontend/dist/

# 3. Upload
scp /tmp/backend.tar.gz /tmp/frontend-dist.tar.gz claude@187.124.128.126:/tmp/

# 4. Deploy en servidor
ssh claude@187.124.128.126 '
source ~/.nvm/nvm.sh
cd /opt/crm/staging                  # o /opt/crm/production
cp .env /tmp/.env.bak
tar -xzf /tmp/backend.tar.gz --strip-components=1
cp /tmp/.env.bak .env
npm install --omit=dev

rm -rf /var/www/crm/staging/frontend/*  # o production
cd /var/www/crm/staging/frontend
tar -xzf /tmp/frontend-dist.tar.gz --strip-components=2

pm2 restart crm-api-staging --update-env

# Verificar
curl -s http://localhost:3002/api/health
'
```

## Rollback manual

Si algo falla en production:

```bash
# 1. Para PM2
pm2 stop crm-api

# 2. Restaurar version anterior
cd /opt/crm/production
git reset --hard HEAD~1            # volver 1 commit
# o restaurar tarball anterior

# 3. Restaurar DB si hicimos migracion
pg_restore -d crm_db /backups/crm_db_YYYY-MM-DD.dump

# 4. Restart
pm2 start crm-api
```

## Diferencias production vs staging

| Aspecto | Staging | Production |
|---------|---------|------------|
| URL | ip/testeo_crm/ | ip/crm/ |
| Puerto backend | 3002 | 3001 |
| DB | crm_test_db | crm_db |
| Vite base | /testeo_crm/ | /crm/ |
| NODE_ENV | staging | production |
| LOG_LEVEL | debug | info |
| PM2 name | crm-api-staging | crm-api |
| Data | Seed + datos QA | Datos reales |

## CI/CD futuro

**PENDIENTE**: setup de GitHub Actions con:

1. Workflow `.github/workflows/deploy-staging.yml`
2. Secret con SSH key del servidor
3. Auto-deploy a staging en push a main
4. Deploy a prod en tag `v*.*.*`
5. Tests obligatorios antes de deploy
