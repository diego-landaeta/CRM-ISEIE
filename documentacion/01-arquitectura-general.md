# 01. Arquitectura General del Sistema

## Vista 10.000 pies

```mermaid
graph TB
    subgraph "Usuarios"
        DE[Landing Psiko]
        LI[Landing ISEIH]
        LF[Landing Fono]
        BR[Navegador CRM]
    end

    subgraph "VPS Hostinger"
        NG[Nginx :80/443]
        subgraph "Backend Node.js"
            PROD[PM2: crm-api :3001]
            STG[PM2: crm-api-staging :3002]
        end
        subgraph "PostgreSQL 17"
            DBP[(crm_db)]
            DBS[(crm_test_db)]
        end
    end

    subgraph "Servicios Externos"
        R2[Cloudflare R2<br/>Dossiers PDF]
        BREVO[Brevo<br/>Email]
        META[Meta Ads API]
        GADS[Google Ads API]
        GSC[Google Search Console]
        STRIPE[Stripe API]
        CLAUDE[Claude API]
    end

    DE -->|POST webhook<br/>API key| NG
    LI -->|POST webhook<br/>API key| NG
    LF -->|POST webhook<br/>API key| NG
    BR -->|GET/POST con JWT| NG

    NG -->|/crm/*| PROD
    NG -->|/testeo_crm/*| STG
    NG -->|/crm o /testeo_crm<br/>estaticos| NG

    PROD -->|pg| DBP
    STG -->|pg| DBS

    PROD -.->|upload PDF| R2
    PROD -.->|send email| BREVO
    PROD -.->|Fase 2| META
    PROD -.->|Fase 2| GADS
    PROD -.->|Fase 2| GSC
    PROD -.->|Fase 2 IA| STRIPE
    PROD -.->|Fase 3 chat| CLAUDE

    style PROD fill:#d4f1d4
    style STG fill:#fff4d4
    style DBP fill:#d4e4f1
    style DBS fill:#fff4d4
```

## Stack tecnologico

| Capa | Tecnologia | Version |
|------|------------|---------|
| **Frontend** | React + Vite + shadcn/ui + Tailwind | 18 / 6 |
| **Backend** | Node.js + Express | 24 LTS / 4.21 |
| **DB** | PostgreSQL | 17.7 |
| **Proceso** | PM2 + systemd | 6.0 |
| **Proxy** | Nginx | 1.26 |
| **Storage** | Cloudflare R2 (S3 compatible) | - |
| **Email** | Brevo API v3 | - |
| **Tests** | Vitest + Supertest | 2.1 |

## Estructura del servidor VPS

```mermaid
graph LR
    subgraph "Filesystem VPS"
        subgraph "/opt/crm"
            PD[production/]
            SD[staging/]
        end
        subgraph "/var/www/crm"
            PFE[production/frontend/]
            SFE[staging/frontend/]
        end
        subgraph "/etc/postgresql/17"
            PGCONF[postgresql.conf]
            HBA[pg_hba.conf]
        end
        subgraph "/etc/nginx/sites-enabled"
            CRMCONF[crm]
        end
    end

    CRMCONF -->|alias| PFE
    CRMCONF -->|alias| SFE
    CRMCONF -->|proxy_pass :3001| PD
    CRMCONF -->|proxy_pass :3002| SD
```

## Rutas Nginx

```mermaid
flowchart LR
    REQ[Request entrante]
    REQ -->|/crm/*| P1[Production Frontend<br/>/var/www/crm/production/frontend]
    REQ -->|/crm/api/*| P2[Production API<br/>localhost:3001]
    REQ -->|/testeo_crm/*| S1[Staging Frontend<br/>/var/www/crm/staging/frontend]
    REQ -->|/testeo_crm/api/*| S2[Staging API<br/>localhost:3002]
    REQ -->|/health| HC[Health check<br/>200 OK]
```

## Arquitectura modular del backend

```
backend/src/
├── app.js                          # Express setup + auto-registro modulos
├── modules/                        # Un directorio por dominio
│   ├── auth/                       # Login, refresh, logout, me
│   ├── users/                      # CRUD usuarios + asignar proyectos
│   ├── leads/                      # Webhook, CRUD, interacciones, reminders
│   ├── products/                   # CRUD productos por proyecto
│   ├── dossiers/                   # Upload PDF, pre-signed URLs
│   └── [nuevo] notifications/      # A agregar (Camino B)
│   └── [nuevo] conversions/        # A agregar (Fase 1 pendiente)
│   └── [nuevo] calendar/           # A agregar (Camino B)
├── shared/
│   ├── config/
│   │   ├── db.js                   # Pool PostgreSQL
│   │   └── r2.js                   # S3 client Cloudflare R2
│   ├── middleware/
│   │   ├── auth.js                 # verifyToken + roleGuard
│   │   ├── projectAccess.js        # Filtrado por proyecto
│   │   ├── errorHandler.js         # Handler global errores
│   │   └── upload.js               # Multer + validacion PDF
│   ├── services/
│   │   └── r2.service.js           # uploadToR2, deleteFromR2
│   └── utils/
│       ├── AppError.js             # Error class custom
│       ├── logger.js               # Pino logger
│       └── presignedUrl.js         # URLs temporales R2 (15min)
├── migrations/                     # SQL secuencial (001, 002, 003...)
├── seeds/                          # Data inicial
└── tests/                          # Vitest + Supertest (73 tests)
```

## Arquitectura modular del frontend

```
frontend/src/
├── App.jsx                         # Router principal + lazy imports
├── main.jsx                        # BrowserRouter dinamico
├── contexts/
│   ├── AuthContext.jsx             # JWT en memoria + refresh auto
│   ├── ProjectContext.jsx          # Proyecto activo
│   └── ThemeContext.jsx            # Dark/light mode
├── modules/
│   ├── leads/                      # Feature leads
│   │   ├── api/
│   │   ├── hooks/
│   │   ├── components/
│   │   └── pages/
│   ├── products/
│   ├── settings/
│   └── [nuevo] calendar/
│   └── [nuevo] notifications/
└── shared/
    ├── api/client.js               # Axios/fetch con interceptors
    ├── components/
    │   ├── ui/                     # StatusBadge, KpiCard, etc
    │   └── layout/                 # Sidebar, Navbar, AppLayout
    ├── hooks/
    └── pages/                      # LoginPage, DashboardPage
```
