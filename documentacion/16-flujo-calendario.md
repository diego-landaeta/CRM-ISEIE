# 16. Calendario (NUEVO - Camino B)

## Concepto

Vista de calendario mensual/semanal con todos los reminders del usuario (y del equipo si es admin). Inspirado en el CRM viejo.

## Vista mensual

```mermaid
flowchart TD
    PAGE[Pagina /calendar]
    PAGE --> H[Header<br/>- mes actual<br/>- navegacion mes anterior/siguiente<br/>- toggle vista: mes / semana / lista]
    PAGE --> GRID[Grid 7x5 o 7x6]
    GRID --> D[Cada dia:<br/>- numero del dia<br/>- chips con reminders del dia<br/>- color segun tipo]
    D --> CLICK[Click en dia]
    CLICK --> DETAIL[Panel lateral:<br/>Lista reminders del dia<br/>Boton + nuevo reminder]
```

## Filtros

```mermaid
flowchart LR
    FP[Filtro panel]
    FP --> F1[Solo mios / Todo el equipo<br/>(admin only)]
    FP --> F2[Proyecto activo / Todos]
    FP --> F3[Pendientes / Completados / Todos]
    FP --> F4[Buscar por nombre lead]
```

## Endpoint backend

```
GET /api/reminders?
  from=2026-04-01
  &to=2026-04-30
  &projectId=1         (opcional)
  &userId=2            (solo admin puede filtrar por otro user)
  &completed=false     (opcional)

Response:
{
  "success": true,
  "data": [
    {
      "id": 1,
      "lead_id": 42,
      "lead_nombre": "Maria Garcia",
      "lead_email": "maria@mail.com",
      "fecha_recordatorio": "2026-04-15",
      "nota": "Llamar para seguimiento",
      "completado": false,
      "created_by": 3,
      "created_by_nombre": "Diego"
    }
  ]
}
```

## Data flow

```mermaid
sequenceDiagram
    participant U as Usuario
    participant F as Frontend Calendar
    participant A as API
    participant DB as DB

    U->>F: Navega a /calendar
    F->>F: Calcula rango del mes visible
    F->>A: GET /api/reminders?from=X&to=Y
    A->>DB: SELECT reminders JOIN leads<br/>WHERE fecha BETWEEN ? AND ?
    DB-->>A: [reminders]
    A-->>F: lista

    F->>F: Agrupa por dia<br/>Renderiza grid calendario

    U->>F: Click en dia 15
    F->>F: Muestra panel lateral<br/>con reminders del 15

    U->>F: Click "Nuevo reminder"
    F->>F: Abre dialog
    U->>F: Selecciona lead (autocomplete) + nota + fecha
    F->>A: POST /api/leads/:id/reminders
    A->>DB: INSERT
    A-->>F: 201
    F->>F: Refresca calendario
```

## UI componentes

```
frontend/src/modules/calendar/
├── pages/
│   └── CalendarPage.jsx
├── components/
│   ├── CalendarMonthView.jsx
│   ├── CalendarWeekView.jsx
│   ├── CalendarDayCell.jsx
│   ├── ReminderChip.jsx        # chip dentro del dia
│   ├── DayDetailPanel.jsx      # lateral con lista
│   └── NewReminderDialog.jsx
└── hooks/
    └── useReminders.js          # cache + invalidacion por rango
```

## Vistas

```mermaid
stateDiagram-v2
    [*] --> Mes: Default
    Mes --> Semana: Toggle
    Semana --> Dia: Click dia
    Dia --> Semana: Back
    Semana --> Mes: Toggle
    Mes --> Lista: Toggle
    Lista --> Mes: Toggle
```

## Integracion con Google Calendar (futuro)

Opcion futura: export .ics para que el usuario suscriba desde Google Calendar:

```
GET /api/reminders/subscribe.ics?token={user_subscription_token}
-> retorna ICS con todos los reminders del usuario
```

## Estado actual

**PENDIENTE implementar.** Los reminders ya se crean/completan. Solo falta la UI de calendario y el endpoint que retorna por rango de fechas.
