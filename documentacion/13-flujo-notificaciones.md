# 13. Notificaciones In-App (NUEVO - Camino B)

## Concepto

Campana en el navbar con badge rojo contando notificaciones no leidas. Click abre panel dropdown con la lista. Idea tomada del CRM viejo + PDF spec.

## Tipos de notificaciones

| Tipo | Cuando se crea | Quien la ve |
|------|---------------|-------------|
| `lead_assigned` | Round-robin asigna lead nuevo | Gestor asignado |
| `reminder_due` | Reminder llega a su fecha | Quien lo creo |
| `status_changed` | Alguien cambia status de lead suyo | Responsable |
| `payment_overdue` | Pago se pasa de fecha | Responsable del lead |
| `mention` | Alguien te menciona en nota (Fase 2) | Usuario mencionado |
| `system` | Anuncios del sistema | Todos / segmento |

## Flujo de creacion y consumo

```mermaid
sequenceDiagram
    autonumber
    participant EV as Evento<br/>(webhook lead / cron / etc)
    participant A as API
    participant DB as DB
    participant F as Frontend
    participant U as Usuario

    EV->>A: Dispara evento<br/>(ej: lead asignado)
    A->>DB: INSERT notifications<br/>(user_id, type, title, body, link)
    A->>A: Broadcast SSE / WebSocket<br/>(opcional - Fase 2)

    Note over F,U: Pooling cada 30s O SSE

    F->>A: GET /api/notifications?unread=true
    A->>DB: SELECT COUNT WHERE user_id AND NOT read
    A-->>F: {count: 3, notifications: [...]}

    F->>F: Muestra badge "3" en campana

    U->>F: Click campana
    F->>A: GET /api/notifications?limit=20
    A->>DB: SELECT con paginacion
    A-->>F: lista completa

    U->>F: Click notificacion
    F->>A: PATCH /api/notifications/:id/read
    A->>DB: UPDATE read_at = NOW()
    F->>F: Navega al link (ej: /leads/42)
```

## Esquema DB nuevo

```sql
-- Migracion 004_notifications.sql
CREATE TYPE notification_type AS ENUM (
  'lead_assigned',
  'reminder_due',
  'status_changed',
  'payment_overdue',
  'mention',
  'system'
);

CREATE TABLE notifications (
  id          SERIAL        PRIMARY KEY,
  user_id     INTEGER       NOT NULL,
  type        notification_type NOT NULL,
  title       VARCHAR(200)  NOT NULL,
  body        TEXT,
  link        VARCHAR(500),  -- URL interna para redirigir
  metadata    JSONB,         -- Datos extra (lead_id, etc)
  read_at     TIMESTAMPTZ,   -- NULL = no leida
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_notif_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_notif_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
```

## Endpoints

```
GET    /api/notifications              -> lista paginada
GET    /api/notifications/unread-count -> {count: N}
PATCH  /api/notifications/:id/read     -> marca como leida
PATCH  /api/notifications/read-all     -> marca todas como leidas
DELETE /api/notifications/:id          -> elimina
```

## Triggers automaticos (en backend)

```mermaid
flowchart LR
    E1[webhook crea lead] -->|dispara| N1[createNotification<br/>type: lead_assigned<br/>user: responsable<br/>link: /leads/id]
    E2[cron reminders vencen] -->|dispara| N2[createNotification<br/>type: reminder_due<br/>user: creator<br/>link: /leads/id]
    E3[status cambiado por OTRO user] -->|dispara| N3[createNotification<br/>type: status_changed<br/>user: responsable<br/>link: /leads/id]
    E4[cron pagos vencidos] -->|dispara| N4[createNotification<br/>type: payment_overdue<br/>user: responsable<br/>link: /conversions/id]
```

## UI de la campana

```mermaid
flowchart TD
    NAV[Navbar top]
    NAV --> BELL[Icono Bell Phosphor]
    BELL --> BADGE{unread_count?}
    BADGE -->|> 0| RED[Badge rojo con numero]
    BADGE -->|0| NONE[Sin badge]
    BELL --> CLICK[Click]
    CLICK --> POP[Popover derecho 400px]
    POP --> LIST[Lista ultimas 20]
    LIST --> ITEM[Cada item:<br/>- icono del type<br/>- titulo<br/>- body preview<br/>- hace X tiempo<br/>- dot azul si unread]
    ITEM --> CLICK2[Click navega al link<br/>+ marca como leida]
    POP --> ACT[Footer:<br/>- Marcar todas leidas<br/>- Ver todas]
```

## Componentes React a crear

```
frontend/src/modules/notifications/
├── api/
│   └── notifications.api.js
├── hooks/
│   ├── useNotifications.js         # polling + count
│   └── useNotificationsList.js     # paginacion
├── components/
│   ├── NotificationBell.jsx        # campana en navbar
│   ├── NotificationPopover.jsx     # dropdown
│   ├── NotificationItem.jsx        # cada fila
│   └── NotificationIcon.jsx        # icono segun type
└── pages/
    └── NotificationsPage.jsx       # /notifications
```

## Polling vs WebSocket / SSE

**Decision actual: Polling cada 30 segundos**
- Simple de implementar
- No requiere infraestructura adicional
- Trade-off: latencia maxima 30s

**Futuro: SSE (Server-Sent Events)**
- Empuje en tiempo real
- Mas eficiente con muchos usuarios
- Requiere mantener conexiones abiertas en Express

## Estado actual

**PENDIENTE implementar completo.** Nada existe todavia en backend ni frontend. Con los diagramas y el schema de DB arriba se puede implementar limpio.
