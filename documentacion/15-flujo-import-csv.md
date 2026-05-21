# 15. Import CSV de Leads (NUEVO - Camino B)

## Concepto

Admin/superadmin puede subir un CSV con leads existentes (migracion desde Excel o otro CRM) y el sistema los procesa en bulk. Inspirado en el CRM viejo.

## Flujo completo

```mermaid
sequenceDiagram
    autonumber
    participant A as Admin
    participant F as Frontend
    participant API as API
    participant DB as DB

    A->>F: Click "Import CSV" en Settings/Leads
    F->>F: Abre ImportCsvModal

    A->>F: Arrastra archivo.csv
    F->>F: Parse con PapaParse<br/>Muestra preview tabla (primeras 5 filas)

    F->>F: Mapea columnas CSV -> campos lead<br/>(auto-detect por header name)

    A->>F: Confirma mapeo<br/>selecciona proyecto destino<br/>selecciona canal default

    F->>API: POST /api/leads/bulk-import<br/>multipart/form-data<br/>+ projectId<br/>+ canal

    API->>API: Parse CSV backend (stream)
    API->>API: Valida cada fila con Zod

    loop Por cada fila valida
        API->>DB: SELECT WHERE email = ? AND project_id = ?<br/>(detectar duplicados)
        alt No existe
            API->>DB: INSERT lead (source: 'csv_import')
            API->>DB: INSERT lead_utms (canal)
        else Ya existe
            API->>API: Saltar o actualizar<br/>(segun flag "update_existing")
        end
    end

    API-->>F: 200 {<br/>  total: 150,<br/>  created: 142,<br/>  skipped: 5,<br/>  errors: 3,<br/>  error_details: [...]<br/>}

    F->>F: Muestra reporte:<br/>- 142 creados<br/>- 5 duplicados<br/>- 3 errores (descargar log)
    F->>A: Toast "Import completado"
```

## Columnas soportadas

| Columna CSV | Campo DB | Requerido |
|-------------|----------|-----------|
| `nombre` / `name` | leads.nombre | SI |
| `email` | leads.email | SI |
| `telefono` / `phone` | leads.telefono | NO |
| `producto` / `producto_interes` | resuelve a producto_interes_id | NO |
| `notas` / `notes` | leads.notas | NO |
| `canal` / `origen` | lead_utms.canal_detectado | NO (default elegido) |
| `fecha` / `fecha_solicitud` | leads.fecha_solicitud | NO (default NOW) |
| `utm_source` | lead_utms.utm_source | NO |
| `utm_medium` | lead_utms.utm_medium | NO |
| `utm_campaign` | lead_utms.utm_campaign | NO |
| `landing_url` | lead_utms.landing_url | NO |

## Reglas

1. **Email es unico por (proyecto, email)**. Si ya existe, se salta o se actualiza segun config.
2. **Round-robin NO se aplica** en import masivo (el admin elige si asignar o dejar sin responsable).
3. **Limite sugerido**: 5000 leads por archivo. Mas de eso, partir en chunks.
4. **Transaccion**: cada 100 filas se hace COMMIT parcial para no bloquear la DB.

## Validaciones

```mermaid
flowchart TD
    ROW[Fila del CSV]
    ROW --> V1{Tiene email?}
    V1 -->|no| ERR1[Error: email requerido]
    V1 -->|si| V2{Email valido?}
    V2 -->|no| ERR2[Error: email invalido]
    V2 -->|si| V3{Tiene nombre?}
    V3 -->|no| ERR3[Error: nombre requerido]
    V3 -->|si| V4{Producto existe<br/>en el proyecto?}
    V4 -->|no| WARN[Warning: producto ignorado<br/>pero se crea el lead]
    V4 -->|si OK| OK[Valido]
    V4 -->|sin producto| OK

    style OK fill:#22c55e
    style ERR1 fill:#ef4444
    style ERR2 fill:#ef4444
    style ERR3 fill:#ef4444
    style WARN fill:#fef3c7
```

## Frontend: modal con steps

```mermaid
flowchart LR
    S1[Step 1<br/>Upload] --> S2[Step 2<br/>Mapeo columnas]
    S2 --> S3[Step 3<br/>Preview + config]
    S3 --> S4[Step 4<br/>Confirmacion + progreso]
    S4 --> S5[Step 5<br/>Reporte final]
```

## Endpoint backend

```
POST /api/leads/bulk-import
Content-Type: multipart/form-data
Body:
  - file: archivo CSV
  - projectId: number
  - canalDefault: enum (default 'directo')
  - updateExisting: boolean (default false)
  - skipFirstRow: boolean (default true - header)

Response:
{
  "success": true,
  "data": {
    "total": 150,
    "created": 142,
    "skipped": 5,
    "errors": 3,
    "errors_detail": [
      { "row": 23, "error": "Email invalido", "data": { ... } }
    ]
  }
}
```

## Permisos

- Solo **superadmin** o **admin** con acceso al proyecto
- Gestor: NO puede hacer bulk import

## Estado actual

**PENDIENTE implementar.** Requiere:
1. Endpoint POST /api/leads/bulk-import con parse CSV
2. Frontend modal multi-step
3. Libreria PapaParse (frontend) o csv-parse (backend)
4. Rate limiting para evitar abuso
