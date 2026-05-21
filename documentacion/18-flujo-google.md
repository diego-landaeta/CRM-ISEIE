# 18. Google Ads + GSC (Fase 2 - PENDIENTE)

## Google Ads

```mermaid
graph TB
    subgraph "Google Ads MCC"
        MCC[MCC Account<br/>agrupa todas las cuentas]
        MCC --> GA1[Psiko Account]
        MCC --> GA2[ISEIH Account]
        MCC --> GA3[Fono Account]
    end

    subgraph "Backend"
        CRON[Cron diario]
        AUTH[OAuth2 tokens<br/>refresh automatico]
        SVC[google.service.js]
        DB[(google_campaigns)]
    end

    CRON --> AUTH
    AUTH --> SVC
    SVC -->|GAQL query| MCC
    SVC --> DB
```

### GAQL (Google Ads Query Language)

```sql
SELECT
  campaign.id,
  campaign.name,
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.conversions
FROM campaign
WHERE segments.date DURING LAST_7_DAYS
```

`cost_micros` = gasto * 1,000,000 (dividir al guardar).

## Google Search Console

Objetivo: medir trafico organico y correlacion con leads.

```mermaid
sequenceDiagram
    participant C as Cron
    participant S as gsc.service
    participant G as GSC API
    participant DB as DB

    C->>S: syncGSC()
    loop Proyecto con GSC config
        S->>G: GET /searchanalytics/query<br/>site: dominio proyecto<br/>dimensions: query, page, device<br/>startDate: hace 3 dias<br/>endDate: hace 2 dias
        Note over G: GSC tiene delay 2-3 dias
        G-->>S: rows con clicks, impressions, ctr, position

        loop Cada fila
            S->>DB: UPSERT gsc_metrics
        end
    end
```

### Cruces de datos

```mermaid
flowchart TD
    L[Lead con utm_medium=organic]
    L --> Q[Query GSC:<br/>palabras clave que trajeron la visita]
    Q --> K[keyword: 'master psicologia clinica']
    K --> M[GSC metrics:<br/>clicks: 145<br/>position: 3.2<br/>CTR: 5.1%]

    CROSS[Correlacion:<br/>keywords + conversion rate]
    K --> CROSS
    M --> CROSS
    CROSS --> INSIGHT[Insight:<br/>keyword X tiene<br/>Y% conversion]
```

## Casos de uso

| Caso | Que responde |
|------|--------------|
| Impacto campanas en organico | Si lanzo Meta, sube/baja el trafico organico? |
| Keywords que convierten | Que busquedas generan mas leads? |
| Canibalizacion SEO vs PPC | Pago CPC por algo que ya posiciono bien? |

## Vista consolidada dashboard

```mermaid
graph LR
    subgraph "Panel consolidado"
        C1[Trafico organico<br/>GSC clicks]
        C2[Trafico pago<br/>Meta + Google clicks]
        C3[Leads totales<br/>CRM]
    end

    SUM[Grafica unica<br/>3 lineas superpuestas<br/>por mes]

    C1 --> SUM
    C2 --> SUM
    C3 --> SUM
```

## ERD

```mermaid
erDiagram
    projects ||--o{ google_campaigns : "cache Google Ads"
    projects ||--o{ gsc_metrics : "cache GSC"

    google_campaigns {
        int id PK
        int project_id FK
        string campaign_id
        string nombre
        decimal cost "cost_micros / 1M"
        int clicks
        int impresiones
        int conversiones
        date date
    }

    gsc_metrics {
        int id PK
        int project_id FK
        string query
        string page_url
        string device
        int clicks
        int impresiones
        decimal ctr
        decimal position
        date date
    }
```

## Estado actual

**TODO PENDIENTE - Fase 2.**
