# 19. Stripe - Proyectos IA (Fase 2 - PENDIENTE)

## Concepto

Los proyectos IA (Psicologo IA, Nutricionista IA, Tarot IA) cobran por suscripcion via Stripe. El CRM solo **lee** los datos para mostrar metricas - no gestiona pagos manualmente.

## Arquitectura

```mermaid
graph TB
    subgraph "Plataforma IA (externa)"
        WEB[Landing Psicologo IA]
        WEB -->|user se suscribe| STRIPE[Stripe]
    end

    subgraph "Backend CRM"
        CRON[Cron diario]
        SVC[stripe.service.js<br/>usa Restricted Key<br/>solo lectura]
        DB[(stripe_metrics)]
    end

    subgraph "Frontend CRM"
        DASH[Dashboard proyectos IA<br/>solo lectura]
    end

    CRON --> SVC
    SVC -->|Restricted Key| STRIPE
    SVC --> DB
    DB -.-> DASH
```

## Metricas que se muestran

```mermaid
graph TD
    M[Metricas proyecto IA]
    M --> M1[MRR<br/>Monthly Recurring Revenue]
    M --> M2[Suscripciones activas]
    M --> M3[Nuevas del mes]
    M --> M4[Canceladas del mes]
    M --> M5[Churn rate %]
    M --> M6[Pagos fallidos]
    M --> M7[Ingresos totales mes]
    M --> M8[Evolucion 12 meses]
```

## Calculos

```
MRR = SUM(importe_suscripcion * frecuencia_mensualizada)
  - Mensual: importe * 1
  - Anual: importe / 12
  - Semanal: importe * 4.33

Churn rate = (canceladas_periodo / activas_periodo_anterior) * 100

Nuevas_netas = nuevas - canceladas
```

## Flujo de sincronizacion

```mermaid
sequenceDiagram
    participant C as Cron
    participant S as stripe.service
    participant ST as Stripe API
    participant DB as DB

    C->>S: syncStripeMetrics()
    loop Proyecto IA
        S->>S: Decrypt restricted key<br/>api_credentials WHERE service='stripe'

        S->>ST: GET /subscriptions?status=active<br/>autopaginating
        ST-->>S: [all active subs]

        S->>S: Calcula MRR<br/>(normaliza anual/mensual/semanal)

        S->>ST: GET /subscriptions?status=canceled<br/>canceled_at>=start_of_month
        ST-->>S: [canceladas mes]

        S->>ST: GET /invoices?status=open<br/>o paid
        ST-->>S: [invoices mes]

        S->>DB: UPSERT stripe_metrics<br/>(project_id, date, mrr, active_subs, ...)
    end
```

## Seguridad: Restricted Key

```mermaid
flowchart TD
    K[Stripe Restricted Key]
    K --> P[Permisos read-only:<br/>- subscriptions:read<br/>- charges:read<br/>- invoices:read<br/>- customers:read]

    K --> D[Deny:<br/>- subscriptions:write<br/>- charges:write<br/>- refunds:write]

    TEST[POST /charges con esta key]
    TEST --> FAIL[403 Forbidden]

    style K fill:#22c55e,color:#fff
    style FAIL fill:#ef4444,color:#fff
```

Si alguien roba la key, solo puede leer, no cobrar ni reembolsar.

## ERD

```mermaid
erDiagram
    projects ||--o{ stripe_metrics : "cache diario"

    stripe_metrics {
        int id PK
        int project_id FK
        decimal mrr
        int active_subs
        int new_subs
        int cancelled_subs
        decimal churn_rate
        int failed_payments
        decimal total_revenue_mtd
        date date
    }

    projects {
        int id PK
        string nombre
        enum type "solo type=ia"
    }
```

## Dashboard IA

```mermaid
graph TB
    subgraph "Dashboard IA"
        TOP[KPIs top:<br/>- MRR actual<br/>- Suscripciones<br/>- Churn<br/>- Ingresos mes]
        G1[Grafica: MRR ultimos 12 meses]
        G2[Grafica: nuevas vs canceladas por mes]
        G3[Pie: suscripciones por plan]
        T1[Tabla: pagos fallidos recientes<br/>con reintento programado]
    end
```

## Estado actual

**TODO PENDIENTE - Fase 2.**

Stories: CRM-96 (Restricted Key), CRM-107 (Schema + cron + MRR + churn), CRM-108 (frontend dashboard IA).
