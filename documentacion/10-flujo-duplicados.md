# 10. Duplicados y Reincidentes

## Logica de deteccion

Cuando llega un lead nuevo, se compara su `email` con los leads existentes del **mismo proyecto**.

```mermaid
flowchart TD
    NEW[Lead nuevo<br/>email: ana@mail.com<br/>project_id: 1<br/>producto: Master]

    NEW --> Q[SELECT * FROM leads<br/>WHERE email = ana@mail.com<br/>AND project_id = 1<br/>ORDER BY created_at DESC<br/>LIMIT 1]

    Q --> CH1{Existe?}
    CH1 -->|NO| NORMAL[Crea lead normal<br/>lead_duplicado_de = NULL<br/>reincidente = false]

    CH1 -->|SI| DUP[Es duplicado]
    DUP --> CH2{Mismo producto?}
    CH2 -->|NO| SIMPLE[lead_duplicado_de = original.id<br/>reincidente = false<br/>Badge amarillo 'Duplicado']
    CH2 -->|SI| REC[lead_duplicado_de = original.id<br/>reincidente = true<br/>Badge rojo 'Reincidente<br/>prioridad alta']

    style NORMAL fill:#22c55e,color:#fff
    style SIMPLE fill:#fef3c7
    style REC fill:#dc2626,color:#fff
```

## Diferencia duplicado vs reincidente

| Escenario | `lead_duplicado_de` | `reincidente` | UI |
|-----------|--------------------|--------------| ---|
| Ana ya pregunto por el Master (mismo proyecto) | original.id | **true** | Badge rojo "Reincidente" |
| Ana ya pregunto por el Curso, ahora por Master | original.id | false | Badge amarillo "Duplicado" |
| Ana ya pregunto en Psiko, ahora en ISEIH | NULL | false | Normal (otro proyecto) |
| Ana lead totalmente nuevo | NULL | false | Normal |

## Estructura de datos

```mermaid
graph LR
    subgraph "Ejemplo: Ana Lopez en Psiko"
        L1[Lead #42<br/>Maria del 2026-03-01<br/>producto: Master<br/>status: no_interesado<br/>lead_duplicado_de: NULL<br/>reincidente: false]

        L2[Lead #87<br/>Maria del 2026-04-10<br/>producto: Master<br/>status: nuevo<br/>lead_duplicado_de: 42<br/>reincidente: true]

        L3[Lead #103<br/>Maria del 2026-04-15<br/>producto: Curso Mindfulness<br/>status: nuevo<br/>lead_duplicado_de: 42<br/>reincidente: false]
    end

    L1 -.-> L2
    L1 -.-> L3

    style L2 fill:#dc2626,color:#fff
    style L3 fill:#fef3c7
```

## Vista en ficha lead

```mermaid
flowchart TD
    DET[Lead Detail Page]
    DET --> H[Header: Ana Lopez<br/>badge: Reincidente]
    DET --> T[Tab 'Duplicados']
    T --> LIST[Lista de leads relacionados:<br/>Mismo email en este proyecto]
    LIST --> L1[Lead #42 - 2026-03-01<br/>Master - no_interesado]
    LIST --> L2[Lead #87 - 2026-04-10<br/>Master - nuevo CURRENT]
    LIST --> L3[Lead #103 - 2026-04-15<br/>Curso - nuevo]

    L1 --> LINK[Click -> navega a ese lead]
    L3 --> LINK
```

## Vista multi-proyecto (PDF spec)

Si Ana tambien esta en ISEIH, se puede ver el historial completo:

```mermaid
graph TB
    VIEW[Vista 360 de ana@mail.com]
    VIEW --> P1[Psiko Aprende<br/>3 leads]
    VIEW --> P2[ISEIH<br/>1 lead]
    VIEW --> P3[Fono<br/>0 leads]

    P1 --> L1[Lead #42 Master - no_interesado]
    P1 --> L2[Lead #87 Master - nuevo]
    P1 --> L3[Lead #103 Mindfulness - nuevo]

    P2 --> L4[Lead #55 Grado Superior - contactado]
```

**PENDIENTE implementar** - requiere endpoint `GET /api/leads/by-email/:email` que busque en todos los proyectos donde el usuario tiene acceso.

## Flujo de gestion de reincidente

```mermaid
sequenceDiagram
    participant W as Webhook
    participant A as API
    participant DB as DB
    participant G as Gestor

    W->>A: POST webhook<br/>email: ana@mail.com<br/>producto: Master
    A->>DB: Check duplicado
    DB-->>A: lead #42 existe<br/>(Master, no_interesado)

    A->>A: Mismo email + proyecto + producto<br/>= REINCIDENTE

    A->>DB: INSERT lead<br/>lead_duplicado_de = 42<br/>reincidente = true

    A->>A: createNotification<br/>tipo: reincidente_alert<br/>prioridad: alta

    G->>G: Ve notificacion<br/>"Lead reincidente Ana"

    G->>G: Ve contexto:<br/>- Ya dijo no_interesado antes<br/>- Vuelve a pedir info<br/>- Quizas cambio de opinion

    Note over G: Gestor llama con contexto:<br/>"Hola Ana, vi que preguntaste antes<br/>por el Master, hay algo especifico<br/>en lo que te pueda ayudar?"
```

## Estado actual

| Feature | Estado |
|---------|--------|
| Detectar duplicado por email + project_id | OK |
| `lead_duplicado_de` en DB | OK |
| **Campo `reincidente` en tabla leads** | **PENDIENTE agregar** |
| **Logica "mismo producto = reincidente"** | **PENDIENTE** |
| Badge frontend duplicado | OK |
| **Badge frontend reincidente** | **PENDIENTE** |
| Tab "Duplicados" en detail | PENDIENTE |
| Vista multi-proyecto 360 | PENDIENTE |
| Notificacion prioridad alta para reincidentes | PENDIENTE |

## Migracion necesaria

```sql
-- 004_reincidente.sql
ALTER TABLE leads ADD COLUMN reincidente BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_leads_reincidente ON leads (project_id, reincidente) WHERE reincidente = true;
```
