# 08. Ciclo de vida del Lead

## Estados y transiciones

```mermaid
stateDiagram-v2
    [*] --> nuevo: webhook recibido
    nuevo --> por_contactar: gestor revisa
    nuevo --> no_interesado: lead inválido / spam
    por_contactar --> contactado: primer contacto (llamada, email)
    contactado --> en_seguimiento: muestra interes
    contactado --> no_interesado: no interesa
    en_seguimiento --> convertido: firma matricula / paga
    en_seguimiento --> no_interesado: descarta
    convertido --> [*]: ciclo cerrado
    no_interesado --> [*]: ciclo cerrado (archivado)
```

## Estados y sus colores

| Status | Color Tailwind | Uso |
|--------|---------------|-----|
| `nuevo` | blue-500 | Recien recibido, sin tocar |
| `por_contactar` | orange-500 | Gestor lo priorizo, va a llamar |
| `contactado` | yellow-500 | Ya hubo primer contacto |
| `en_seguimiento` | purple-500 | Interesado, conversacion abierta |
| `convertido` | green-500 | Matriculado/comprado |
| `no_interesado` | red-500 | Cerrado sin conversion |

## Quien puede cambiar el status

```mermaid
flowchart TD
    LEAD[Lead]
    LEAD --> WHO{Quien cambia?}
    WHO -->|superadmin| ALLOW[Cualquier lead]
    WHO -->|admin| CH1{Proyecto<br/>asignado?}
    CH1 -->|si| ALLOW
    CH1 -->|no| DENY1[403]
    WHO -->|gestor| CH2{Es responsable?}
    CH2 -->|si| ALLOW
    CH2 -->|no| DENY2[403]

    ALLOW --> RECORD[INSERT lead_status_history]
    RECORD --> UPDATE[UPDATE leads.status]

    style ALLOW fill:#22c55e
    style DENY1 fill:#ef4444
    style DENY2 fill:#ef4444
```

## Historial de cambios

Cada cambio de status se registra automaticamente:

```mermaid
sequenceDiagram
    participant U as Usuario
    participant A as API
    participant DB as DB

    U->>A: PATCH /api/leads/42/status<br/>{status: 'convertido', motivo: 'Firmo hoy'}
    A->>A: Zod valida (status + motivo obligatorio)
    A->>DB: BEGIN
    A->>DB: UPDATE leads SET status = 'convertido'<br/>WHERE id = 42
    A->>DB: INSERT lead_status_history<br/>(lead_id, anterior, nuevo, changed_by)
    A->>DB: COMMIT
    A-->>U: 200 {previous, current}

    Note over U: Frontend muestra historial<br/>en tab "Historial" del detalle
```

## Vista del gestor: su dia a dia

```mermaid
flowchart LR
    START[Inicia jornada] --> D[Dashboard<br/>Ve KPIs dia]
    D --> R{Tiene reminders hoy?}
    R -->|si| LIST[Lista reminders]
    LIST --> OPEN[Abre lead]
    R -->|no| P[Pipeline view]
    P --> NEW[Columna 'nuevo']
    NEW --> OPEN2[Abre lead]
    OPEN --> CONTACT[Llama / Email]
    OPEN2 --> CONTACT
    CONTACT --> INT[Registra interaccion]
    INT --> CHSTATUS{Cambia status?}
    CHSTATUS -->|si| UPD[Actualiza status<br/>+ motivo]
    CHSTATUS -->|no| REM[Programa reminder]
    UPD --> CLOSE[Vuelve al pipeline]
    REM --> CLOSE
```

## Alerta por inactividad (PDF spec)

Cada proyecto tiene `dias_alerta_inactividad` (default 3). Si un lead no tiene actualizacion en ese periodo, aparece alerta visual:

```mermaid
flowchart TD
    LEAD[Lead status != convertido/no_interesado]
    LEAD --> CALC[dias_sin_update = NOW - MAX<br/>(updated_at, last_interaction)]
    CALC --> CHECK{dias_sin_update ><br/>dias_alerta_inactividad?}
    CHECK -->|SI| BADGE[Badge rojo pulsante<br/>'Inactivo X dias']
    CHECK -->|NO| NORM[Visualizacion normal]

    style BADGE fill:#fef3c7,color:#92400e
```

**PENDIENTE**: implementar este badge en LeadsPage + LeadDetailPage.

## Transiciones invalidas

Actualmente el backend no restringe transiciones (cualquier status puede ir a cualquiera). Esto es intencional porque:

- Un lead puede volver de `convertido` a `en_seguimiento` si se arrepiente y vuelve a negociar
- Un `no_interesado` puede reactivarse si vuelve a llamar

Lo unico que se valida es que **status nuevo != status actual** (error `SAME_STATUS`).

## Metricas derivadas (Dashboard)

```mermaid
graph TD
    DB[(leads + lead_status_history)]
    DB --> M1[Tasa de conversion<br/>convertidos / total]
    DB --> M2[Tiempo medio a conversion<br/>AVG fecha_conversion - fecha_solicitud]
    DB --> M3[Leads abandonados<br/>sin update > X dias]
    DB --> M4[Conversion por canal<br/>group by utm.canal_detectado]
    DB --> M5[Performance gestor<br/>convertidos / asignados]
```

**Estado actual**: Dashboard muestra total por status. Las metricas derivadas estan PENDIENTES de implementar.
