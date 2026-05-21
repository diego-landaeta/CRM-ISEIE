# 09. Conversion y Pagos

## Flujo: convertir lead

```mermaid
sequenceDiagram
    autonumber
    participant G as Gestor
    participant F as Frontend
    participant A as API
    participant DB as DB

    G->>F: Lead #42 ya firmo
    F->>F: Click 'Marcar como convertido'
    F->>F: Abre ConversionDialog con datos:<br/>producto, importe, metodo, plazos

    G->>F: Completa formulario
    F->>A: POST /api/conversions<br/>{lead_id, project_id, producto_contratado,<br/>importe_total, metodo_pago, ...}

    A->>A: Valida Zod
    A->>DB: BEGIN

    A->>DB: INSERT conversions<br/>(importe_pagado = 0 si fraccionado)
    A->>DB: UPDATE leads SET status = 'convertido'
    A->>DB: INSERT lead_status_history

    alt metodo_pago = unico
        A->>DB: INSERT conversion_payments<br/>(importe completo, fecha = hoy)
        A->>DB: UPDATE conversions<br/>importe_pagado = importe_total
    else metodo_pago = fraccionado
        Note over A: Sin INSERT payments.<br/>Se registran despues manualmente.
    end

    A->>DB: COMMIT
    A-->>F: 201 {conversion_id}

    F->>G: Toast "Conversion registrada"
    F->>F: Navega a ConversionDetail
```

## Flujo: registrar abono parcial

```mermaid
sequenceDiagram
    participant G as Gestor/Admin
    participant F as Frontend
    participant A as API
    participant DB as DB

    G->>F: Click 'Registrar abono'
    F->>F: Abre dialog: importe, fecha, notas
    G->>F: Completa
    F->>A: POST /api/conversions/42/payments<br/>{importe, fecha, notas}

    A->>DB: BEGIN
    A->>DB: INSERT conversion_payments
    A->>DB: UPDATE conversions<br/>SET importe_pagado = importe_pagado + {importe}
    A->>DB: COMMIT

    A->>A: Recalcula importe_pendiente<br/>= importe_total - importe_pagado

    alt importe_pendiente <= 0
        A->>DB: UPDATE conversions<br/>SET fecha_compromiso_pago = NULL<br/>(ya no hay pendiente)
    end

    A-->>F: 200 {importe_pendiente}
    F->>G: Toast "Abono registrado"
```

## Estructura de una conversion con pagos

```
conversion #1 (Maria Garcia)
├── producto_contratado: "Master en Psicologia"
├── importe_total: 2500.00
├── importe_pagado: 1500.00
├── importe_pendiente: 1000.00 (calculado)
├── metodo_pago: "fraccionado"
├── fecha_compromiso_pago: 2026-05-15
│
├── payments (conversion_payments)
│   ├── #1: 500 EUR el 2026-04-01 (matricula)
│   ├── #2: 500 EUR el 2026-05-01 (primer plazo)
│   └── #3: 500 EUR el 2026-05-15 (segundo plazo)
│
└── pendiente: 1000 EUR (se recalcula en cada INSERT payment)
```

## Cron pagos vencidos (PENDIENTE implementar)

```mermaid
flowchart TD
    CRON[Cron diario 8am] --> Q[SELECT conversions<br/>WHERE importe_pendiente > 0<br/>AND fecha_compromiso_pago < TODAY]
    Q --> FOREACH{Para cada conversion vencida}
    FOREACH --> EMAIL[Enviar email Brevo<br/>al responsable del lead]
    EMAIL --> LOG[Log en activity_log]
    FOREACH --> NEXT[Siguiente]

    style CRON fill:#3b82f6,color:#fff
```

## Dashboard de ingresos

```mermaid
graph TB
    subgraph "KPIs principales"
        K1[Total facturado<br/>SUM importe_total]
        K2[Total cobrado<br/>SUM importe_pagado]
        K3[Total pendiente<br/>SUM importe_pendiente]
        K4[Conversiones mes<br/>COUNT fecha_conversion >= month_start]
    end

    subgraph "Graficas"
        G1[Linea: ingresos por mes<br/>ultimos 12 meses]
        G2[Barras: conversiones por proyecto]
        G3[Pie: metodos de pago]
    end

    subgraph "Tablas"
        T1[Pagos pendientes<br/>fecha_compromiso proxima]
        T2[Pagos vencidos<br/>fecha_compromiso < hoy]
    end

    K1 --> DB[(conversions)]
    K2 --> DB
    K3 --> DB
    K4 --> DB
    G1 --> DB
    G2 --> DB
    G3 --> DB
    T1 --> DB
    T2 --> DB
```

## Estado actual

| Componente | Estado |
|-----------|--------|
| Tabla `conversions` | OK |
| Tabla `conversion_payments` | OK |
| Endpoint POST /api/conversions | PENDIENTE |
| Endpoint POST /api/conversions/:id/payments | PENDIENTE |
| Endpoint GET /api/conversions?projectId | PENDIENTE |
| Dashboard ingresos frontend | Mock (datos falsos) |
| Cron pagos vencidos | PENDIENTE |
| Tests conversions | PENDIENTE |

## JSON de respuesta esperada

```json
{
  "success": true,
  "data": {
    "id": 1,
    "lead_id": 42,
    "project_id": 1,
    "lead_nombre": "Maria Garcia",
    "producto_contratado": "Master en Psicologia",
    "importe_total": 2500.00,
    "importe_pagado": 1500.00,
    "importe_pendiente": 1000.00,
    "metodo_pago": "fraccionado",
    "fecha_compromiso_pago": "2026-05-15",
    "fecha_conversion": "2026-04-01",
    "payments": [
      { "id": 1, "importe": 500, "fecha": "2026-04-01", "notas": "Matricula" },
      { "id": 2, "importe": 500, "fecha": "2026-05-01", "notas": "Primer plazo" },
      { "id": 3, "importe": 500, "fecha": "2026-05-15", "notas": "Segundo plazo" }
    ],
    "created_at": "2026-04-01T10:30:00Z",
    "updated_at": "2026-05-15T14:20:00Z"
  }
}
```
