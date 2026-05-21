# 11. Interacciones y Recordatorios

## Tipos de interaccion

```mermaid
graph LR
    L[Lead]
    L --> I1[llamada<br/>Phone icon]
    L --> I2[email<br/>Envelope icon]
    L --> I3[whatsapp<br/>WhatsappLogo icon]
    L --> I4[nota<br/>NotePencil icon]

    style I1 fill:#3b82f6,color:#fff
    style I2 fill:#8b5cf6,color:#fff
    style I3 fill:#22c55e,color:#fff
    style I4 fill:#6b7280,color:#fff
```

## ERD

```mermaid
erDiagram
    leads ||--o{ lead_interactions : "historial"
    leads ||--o{ lead_reminders : "recordatorios"
    users ||--o{ lead_interactions : "creador"
    users ||--o{ lead_reminders : "creador"

    lead_interactions {
        int id PK
        int lead_id FK
        enum tipo
        text nota
        timestamp fecha
        int created_by FK
    }

    lead_reminders {
        int id PK
        int lead_id FK
        date fecha_recordatorio
        text nota
        bool completado
        int created_by FK
    }

    leads {
        int id PK
        string nombre
        string email
    }

    users {
        int id PK
        string nombre
    }
```

## Timeline de interacciones

```mermaid
timeline
    title Historial de Ana Lopez (Lead #87)
    2026-04-10 10:30 : Lead creado (webhook) : canal meta_ads
    2026-04-10 14:15 : Llamada de Laura : "Primer contacto, muy interesada"
    2026-04-10 15:00 : Email de Laura : "Enviado dossier informativo"
    2026-04-11 11:20 : WhatsApp de Laura : "Confirma asistencia a jornada"
    2026-04-15 09:00 : Nota de Laura : "Cliente potencial alto"
    2026-04-18 : Recordatorio pendiente : "Llamar con propuesta final"
```

## Flujo: crear interaccion

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuario
    participant F as Frontend
    participant A as API
    participant DB as DB

    U->>F: En LeadDetailPage<br/>Tab 'Interacciones'<br/>Click 'Nueva interaccion'

    F->>F: Abre dialog:<br/>- tipo (select)<br/>- nota (textarea)

    U->>F: tipo='llamada'<br/>nota='Muy interesada en el master'

    F->>A: POST /api/leads/42/interactions<br/>{tipo, nota}

    A->>A: verifyToken + projectAccess
    A->>A: Zod valida
    A->>DB: findById lead
    A->>DB: INSERT lead_interactions<br/>(lead_id, tipo, nota, created_by, fecha=NOW)

    A-->>F: 201 {id, fecha, ...}

    F->>F: Actualiza timeline<br/>Agrega nuevo item arriba<br/>Toast "Interaccion registrada"
```

## Flujo: crear y completar reminder

```mermaid
sequenceDiagram
    participant U as Usuario
    participant F as Frontend
    participant A as API
    participant DB as DB
    participant CRON as Cron diario
    participant BR as Brevo

    U->>F: Tab 'Recordatorios'<br/>Click 'Nuevo reminder'
    F->>F: Abre dialog<br/>- fecha (date picker)<br/>- nota (text)

    U->>F: fecha=2026-04-20<br/>nota='Llamar con propuesta'
    F->>A: POST /api/leads/42/reminders
    A->>DB: INSERT lead_reminders<br/>completado=false
    A-->>F: 201

    Note over CRON: Dia 2026-04-20 8am

    CRON->>DB: SELECT reminders<br/>WHERE fecha = TODAY<br/>AND completado = false
    DB-->>CRON: [reminders]

    loop Cada reminder
        CRON->>BR: Email al created_by<br/>"Tienes 1 reminder hoy"
        CRON->>DB: INSERT notification<br/>type: reminder_due
    end

    U->>F: Ve campana notificacion
    U->>F: Click reminder
    F->>F: Navega a /leads/42

    U->>F: Completa la tarea<br/>Click checkbox reminder
    F->>A: PATCH /api/leads/reminders/:id/complete
    A->>DB: UPDATE completado = true
    A-->>F: 200
```

## Vista calendario (PENDIENTE)

Los reminders se pueden ver tambien en vista calendario (ver [16-flujo-calendario.md](16-flujo-calendario.md)).

## Alerta por inactividad

Segun PDF spec, cada proyecto tiene `dias_alerta_inactividad`. Si un lead no tiene interacciones ni cambios en ese periodo, aparece alerta visual.

```mermaid
flowchart TD
    LEAD[Lead en 'en_seguimiento']
    LEAD --> CALC[dias_inactivo = NOW - MAX de:<br/>- leads.updated_at<br/>- MAX interactions.fecha<br/>- MAX status_history.changed_at]

    CALC --> CH{dias_inactivo > dias_alerta_inactividad?}
    CH -->|NO| OK[Sin alerta]
    CH -->|SI| AL[Badge rojo<br/>'Sin actividad desde hace X dias']

    style AL fill:#dc2626,color:#fff
```

**PENDIENTE** implementar este calculo en la query de `lead.list()`.

## Estado actual

| Feature | Backend | Frontend |
|---------|---------|----------|
| Crear interaccion | OK | OK (dialog) |
| Listar interacciones | OK (en detail) | OK (timeline) |
| Tipos con iconos correctos | N/A | OK |
| Crear reminder | OK | OK (dialog) |
| Completar reminder | OK | OK (checkbox) |
| Listar reminders | OK (en detail) | OK |
| Cron alerta email reminders | PENDIENTE | - |
| Notificacion in-app al vencer | PENDIENTE | PENDIENTE |
| Vista calendario | - | PENDIENTE |
| Alerta inactividad | PENDIENTE calculo | PENDIENTE badge |
