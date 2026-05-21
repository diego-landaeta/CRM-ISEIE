# 02. Entornos: Production vs Staging

## Vista general

```mermaid
graph TB
    subgraph "VPS Hostinger 187.124.128.126"
        NG[Nginx :80/443]

        subgraph "Backend"
            PRD[crm-api PM2<br/>localhost:3001]
            STG[crm-api-staging PM2<br/>localhost:3002]
        end

        subgraph "Filesystem"
            PFE[/var/www/crm/production/frontend/]
            SFE[/var/www/crm/staging/frontend/]
            PCODE[/opt/crm/production/]
            SCODE[/opt/crm/staging/]
        end

        subgraph "PostgreSQL :5432"
            DBP[(crm_db<br/>produccion)]
            DBS[(crm_test_db<br/>staging)]
        end
    end

    BROWSER_P[Usuario real]
    BROWSER_S[QA / Dev]

    BROWSER_P -->|/crm/*| NG
    BROWSER_S -->|/testeo_crm/*| NG

    NG -->|alias estatico| PFE
    NG -->|alias estatico| SFE
    NG -->|proxy_pass| PRD
    NG -->|proxy_pass| STG

    PRD -->|pg| DBP
    STG -->|pg| DBS

    PCODE -.->|node src/app.js| PRD
    SCODE -.->|node src/app.js| STG

    style PRD fill:#22c55e,color:#fff
    style STG fill:#f59e0b,color:#fff
    style DBP fill:#22c55e,color:#fff
    style DBS fill:#f59e0b,color:#fff
```

## Tabla comparativa

| Aspecto | Production | Staging |
|---------|-----------|---------|
| URL | `/crm/` | `/testeo_crm/` |
| API | `/crm/api/*` | `/testeo_crm/api/*` |
| Puerto Node | 3001 | 3002 |
| Backend | `/opt/crm/production/` | `/opt/crm/staging/` |
| Frontend | `/var/www/crm/production/frontend/` | `/var/www/crm/staging/frontend/` |
| DB | `crm_db` | `crm_test_db` |
| PM2 name | `crm-api` | `crm-api-staging` |
| NODE_ENV | production | staging |
| LOG_LEVEL | info | debug |
| Vite base | `/crm/` | `/testeo_crm/` |
| Datos | Reales | Seed + datos QA |

## Ciclo: desarrollo -> staging -> production

```mermaid
flowchart LR
    DEV[Dev local<br/>localhost:5173] --> COMMIT[git commit]
    COMMIT --> PUSH[git push main]
    PUSH --> DEPLOY_S[Deploy staging]
    DEPLOY_S --> QA[QA manual en<br/>ip/testeo_crm]
    QA --> OK{OK?}
    OK -->|no| DEV
    OK -->|si| DEPLOY_P[Deploy production]
    DEPLOY_P --> LIVE[Usuarios en ip/crm]

    style DEV fill:#3b82f6,color:#fff
    style QA fill:#f59e0b,color:#fff
    style LIVE fill:#22c55e,color:#fff
```

## Nginx config simplificado

```nginx
server {
    listen 80 default_server;

    # Staging
    location /testeo_crm {
        alias /var/www/crm/staging/frontend;
        try_files $uri $uri/ /testeo_crm/index.html;
    }
    location /testeo_crm/api {
        proxy_pass http://localhost:3002/api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Production
    location /crm {
        alias /var/www/crm/production/frontend;
        try_files $uri $uri/ /crm/index.html;
    }
    location /crm/api {
        proxy_pass http://localhost:3001/api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /health {
        return 200 "OK - CRM Server";
    }
}
```

## Aislamiento de datos

Cada entorno tiene su propia DB. **NUNCA** conectar staging a crm_db ni production a crm_test_db.

Los refresh tokens son por DB, asi que una sesion de staging no funciona en production y viceversa.
