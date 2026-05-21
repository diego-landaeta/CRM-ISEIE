# 07. Flujo de Webhook de Leads + Round-Robin

## Vision general

Un formulario en la landing del proyecto hace POST al webhook. El backend crea el lead, detecta duplicados, parsea UTMs, y asigna automaticamente al siguiente gestor en la cola (round-robin). Todo en < 500ms.

## Flujo completo

```mermaid
sequenceDiagram
    autonumber
    participant F as Formulario<br/>landing
    participant N as Nginx
    participant A as API Express<br/>:3001
    participant DB as PostgreSQL
    participant B as Brevo<br/>(async)
    participant G as Gestor<br/>(in-app)

    F->>N: POST /api/leads/webhooks/psiko-aprende<br/>Authorization: Bearer {api_key}<br/>Body: {nombre, email, utm_*}
    N->>A: proxy_pass

    A->>A: Valida Zod schema
    alt Payload invalido
        A-->>F: 400 VALIDATION_ERROR
    end

    A->>DB: SELECT * FROM projects<br/>WHERE slug = 'psiko-aprende'
    DB-->>A: project o null

    alt Proyecto no existe
        A-->>F: 404 PROJECT_NOT_FOUND
    end

    A->>A: Compara api_key con<br/>project.webhook_api_key
    alt API key invalida
        A-->>F: 401 INVALID_API_KEY
    end

    A->>DB: BEGIN TRANSACTION

    A->>DB: Detectar duplicado<br/>SELECT * FROM leads<br/>WHERE email = ? AND project_id = ?
    DB-->>A: duplicate o null

    A->>DB: Detectar producto por nombre<br/>(si producto_interes viene)
    DB-->>A: product_id o null

    A->>A: detectChannel(utm_source, utm_medium)<br/>-> 'meta_ads' / 'google_ads' / etc

    A->>DB: SELECT project_queue_state<br/>WHERE project_id = ?<br/>FOR UPDATE (lock)
    DB-->>A: {last_assigned_index}

    A->>DB: SELECT gestores activos<br/>FROM user_projects up<br/>JOIN users u<br/>WHERE project_id = ? AND active
    DB-->>A: [gestor_ids ordenados]

    A->>A: nextIndex = (last + 1) % gestores.length<br/>responsable_id = gestores[nextIndex]

    A->>DB: UPDATE project_queue_state<br/>SET last_assigned_index = nextIndex

    A->>DB: INSERT INTO leads (...)<br/>responsable_id, lead_duplicado_de

    alt Tiene UTMs
        A->>DB: INSERT INTO lead_utms (...)<br/>canal_detectado
    end

    A->>DB: COMMIT
    DB-->>A: lead_id

    A-->>F: 201 {lead_id, responsable_id,<br/>duplicado, canal}

    par Async (no bloquea respuesta)
        A->>B: send email notification<br/>(TODO CRM-56)
        A->>G: push notification in-app<br/>(TODO Camino B)
    end
```

## Flujo de detección de canal

```mermaid
flowchart TD
    START[utm_source + utm_medium]
    START --> CHECK1{Ninguno?}
    CHECK1 -->|si| DIR[directo]
    CHECK1 -->|no| CHECK2{source contiene<br/>facebook/instagram/fb/meta?}
    CHECK2 -->|si| META[meta_ads]
    CHECK2 -->|no| CHECK3{source contiene google<br/>AND medium in cpc/ppc?}
    CHECK3 -->|si| GADS[google_ads]
    CHECK3 -->|no| CHECK4{source contiene tiktok?}
    CHECK4 -->|si| TIK[tiktok_ads]
    CHECK4 -->|no| CHECK5{source contiene<br/>chatgpt/openai?}
    CHECK5 -->|si| CGPT[chatgpt_ia]
    CHECK5 -->|no| CHECK6{medium = referral<br/>OR source contiene referido?}
    CHECK6 -->|si| REF[referido]
    CHECK6 -->|no| CHECK7{medium = organic<br/>OR source contiene google/bing?}
    CHECK7 -->|si| ORG[organico]
    CHECK7 -->|no| DIR2[directo]

    style META fill:#1877F2,color:#fff
    style GADS fill:#EA4335,color:#fff
    style TIK fill:#000,color:#fff
    style CGPT fill:#10A37F,color:#fff
    style ORG fill:#34A853,color:#fff
    style REF fill:#8B5CF6,color:#fff
    style DIR fill:#6B7280,color:#fff
    style DIR2 fill:#6B7280,color:#fff
```

## Round-robin: ejemplo visual

Proyecto **Psiko Aprende** tiene 3 gestores: Laura, Carlos, Ana (en ese orden).

```mermaid
graph LR
    L1[Lead 1] -->|asigna a| G1[Laura]
    L2[Lead 2] -->|asigna a| G2[Carlos]
    L3[Lead 3] -->|asigna a| G3[Ana]
    L4[Lead 4] -->|rota a| G1
    L5[Lead 5] -->|rota a| G2

    style G1 fill:#fef3c7
    style G2 fill:#fef3c7
    style G3 fill:#fef3c7
```

Estado en `project_queue_state`:

| project_id | last_assigned_index | last_assigned_user_id |
|------------|---------------------|----------------------|
| 1 | 0 | Laura (tras lead 1) |
| 1 | 1 | Carlos (tras lead 2) |
| 1 | 2 | Ana (tras lead 3) |
| 1 | 0 | Laura (tras lead 4 - vuelve) |

## Gestor inactivo - que pasa?

Si **Carlos esta inactivo** (`user_projects.active = false` o `users.active = false`), el query de gestores no lo devuelve. La cola funciona solo con [Laura, Ana]:

```mermaid
graph LR
    L1[Lead 1] --> L[Laura]
    L2[Lead 2] --> A[Ana]
    L3[Lead 3] --> L
    L4[Lead 4] --> A
```

## Duplicados

Si ya existe un lead con el mismo email en el MISMO proyecto:

```mermaid
flowchart LR
    LEAD[Lead nuevo<br/>email: ana@mail.com] --> CHECK{Existe lead<br/>con ese email<br/>en este proyecto?}
    CHECK -->|NO| CREATE[Crea lead<br/>lead_duplicado_de = null]
    CHECK -->|SI| DUP[Crea lead<br/>lead_duplicado_de = original_id<br/>Frontend muestra badge]

    style DUP fill:#fef3c7
```

Importante: segun el PDF spec, si es **mismo proyecto + mismo producto** hay que marcar `reincidente = true`. **PENDIENTE** agregar esa logica.

## Performance requerida

- Respuesta < 500ms (segun PDF spec)
- Email Brevo async (no bloquea respuesta)
- SELECT FOR UPDATE solo bloquea 1 fila (project_queue_state)
- Indices usados: `idx_leads_email`, `idx_leads_project_id`

## Seguridad

- API key por header `Authorization: Bearer {key}` (PDF spec) o `X-API-Key` (actual - **pendiente corregir**)
- CORS configurable por dominio del proyecto (PDF seccion 03)
- Rate limiting: **PENDIENTE** agregar (proteccion contra abuso)
