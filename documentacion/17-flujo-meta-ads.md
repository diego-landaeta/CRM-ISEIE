# 17. Meta Ads API (Fase 2 - PENDIENTE)

## Objetivo

Vincular campanas de Meta Ads con los leads del CRM via `utm_campaign` para medir CPA real vs CPA reportado.

## Arquitectura

```mermaid
graph TB
    subgraph "Meta Business Manager"
        BM[Business Manager]
        BM --> MA1[Meta Ad Account<br/>Psiko]
        BM --> MA2[Meta Ad Account<br/>ISEIH]
        BM --> MA3[Meta Ad Account<br/>Fono]
    end

    subgraph "Backend CRM"
        CRON[Cron diario 2am]
        SVC[meta.service.js]
        DB[(meta_campaigns<br/>+ leads.utm_campaign)]
    end

    CRON --> SVC
    SVC -.->|token larga duracion| BM
    SVC --> DB

    subgraph "Frontend"
        DASH[Panel Campanas Meta]
        DET[Detail Lead<br/>muestra campana origen]
    end

    DB -.-> DASH
    DB -.-> DET
```

## Flujo de sincronizacion diaria

```mermaid
sequenceDiagram
    autonumber
    participant C as Cron 2am
    participant S as meta.service
    participant M as Meta API
    participant DB as DB

    C->>S: syncMetaCampaigns()
    loop Para cada proyecto con Meta config
        S->>DB: SELECT project.meta_account_id<br/>+ api_credentials(service=meta)
        DB-->>S: {account_id, encrypted_token}
        S->>S: Decrypt token AES-256

        S->>M: GET /act_{account_id}/campaigns<br/>?fields=id,name,status,insights<br/>&time_range=yesterday

        alt Rate limit (error 17)
            M-->>S: 429
            S->>S: Backoff exponencial 2^n segundos
            S->>M: reintentar
        end

        M-->>S: [campaigns con metricas]

        loop Cada campana
            S->>DB: UPSERT meta_campaigns<br/>(project_id, campaign_id, date, gasto, ...)
        end
    end
```

## Vincular lead con campana

```mermaid
flowchart LR
    L[Lead] --> UTM[utm_campaign:<br/>'psiko-master-abril']
    UTM --> MATCH[SELECT campaign_id<br/>FROM meta_campaigns<br/>WHERE nombre = utm_campaign]
    MATCH --> C[Campaign Meta:<br/>gasto_dia: 150 EUR<br/>leads_meta: 12<br/>CPA_meta: 12.5 EUR]

    subgraph "CRM calcula"
        CPA_REAL[CPA_real =<br/>gasto / leads_CRM_convertidos]
    end

    C --> CPA_REAL
```

## Entidades

```mermaid
erDiagram
    projects ||--o{ api_credentials : "credenciales"
    projects ||--o{ meta_campaigns : "cache"
    leads }o--|| meta_campaigns : "vincula por utm_campaign"

    api_credentials {
        int id PK
        int project_id FK
        enum service "meta/google_ads/gsc/stripe/claude"
        text encrypted_key "AES-256"
        timestamp expires_at
        bool active
    }

    meta_campaigns {
        int id PK
        int project_id FK
        string campaign_id UK
        string nombre
        string objective
        decimal gasto
        int impresiones
        int alcance
        int clicks
        decimal ctr
        decimal cpm
        decimal cpc
        int leads_meta
        date date
    }
```

## Panel frontend (PENDIENTE)

```mermaid
flowchart TD
    PAGE[Pagina /campaigns/meta]
    PAGE --> H[Filtros:<br/>- proyecto<br/>- rango fecha<br/>- estado campana]
    PAGE --> KPI[KPIs top:<br/>- Gasto total<br/>- Impresiones<br/>- Leads Meta<br/>- Leads CRM<br/>- CPA Meta vs CRM]
    PAGE --> T[Tabla campanas:<br/>nombre, gasto, clicks,<br/>leads_meta, leads_crm,<br/>conversiones, CPA]
    PAGE --> G[Grafica evolucion<br/>gasto vs leads diarios]
```

## Endpoints a crear

```
GET  /api/meta/campaigns?projectId=X&from=Y&to=Z
GET  /api/meta/campaigns/:id/leads      (leads vinculados)
POST /api/meta/sync-now?projectId=X     (disparar sync manual)
GET  /api/meta/credentials?projectId=X  (admin/SA only)
POST /api/meta/credentials              (configurar token)
```

## Permisos

- **Credenciales** (ver token): solo superadmin
- **Metricas**: admin + gestor (solo proyectos asignados)
- **Sync manual**: admin + superadmin

## Estado actual

**TODO PENDIENTE** - es Fase 2 completa.

Stories Jira:
- CRM-92 Crear Facebook App + App Review
- CRM-93 System User Meta + token larga duracion
- CRM-98 Schema + cron diario
- CRM-99 Retry backoff error 17
- CRM-100 Vinculacion utm_campaign
- CRM-101 Frontend modulo campanas Meta
