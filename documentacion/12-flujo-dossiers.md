# 12. Dossiers (PDFs)

## Concepto

Cada producto de un proyecto puede tener un PDF informativo (dossier). Se almacena en Cloudflare R2 (S3 compatible) y se sirve via pre-signed URLs temporales.

## ERD

```mermaid
erDiagram
    projects ||--o{ products : "tiene"
    products ||--o{ dossiers : "versiones PDF"
    users ||--o{ dossiers : "subio"
    products ||--o{ leads : "interes"
    leads {
        bool dossier_enviado
        timestamp dossier_enviado_at
    }

    products {
        int id PK
        int project_id FK
        string nombre
    }

    dossiers {
        int id PK
        int product_id FK
        string s3_key "R2 object key"
        string filename_original
        int version "1, 2, 3..."
        bool active "solo 1 activa por producto"
        bigint size_bytes
        int subido_por FK
        timestamp created_at
    }

    leads {
        int id PK
        int producto_interes_id FK
        bool dossier_enviado
        timestamp dossier_enviado_at
    }

    users {
        int id PK
        string nombre
    }
```

## Upload: flujo completo

```mermaid
sequenceDiagram
    autonumber
    participant U as Admin
    participant F as Frontend
    participant A as API
    participant R2 as Cloudflare R2
    participant DB as DB

    U->>F: Productos > click producto > tab Dossiers<br/>Click 'Subir nueva version'
    F->>F: Abre dialog con drag&drop

    U->>F: Arrastra PDF
    F->>F: Valida mime-type + tamano < 10MB

    F->>A: POST /api/dossiers/upload<br/>multipart/form-data<br/>+ product_id

    A->>A: verifyToken + roleGuard(admin,SA)
    A->>A: projectAccess check (producto -> proyecto)
    A->>A: Valida magic bytes PDF (%PDF)
    A->>A: Genera s3_key:<br/>dossiers/{proj_slug}/{prod_id}/{uuid}-{timestamp}.pdf

    A->>R2: PutObject (S3 SDK)<br/>Bucket: crm-dossiers
    R2-->>A: 200 OK

    A->>DB: BEGIN
    A->>DB: UPDATE dossiers<br/>SET active = false<br/>WHERE product_id = X<br/>(desactiva version anterior)

    A->>DB: SELECT MAX(version) + 1<br/>FROM dossiers WHERE product_id = X
    DB-->>A: nueva_version

    A->>DB: INSERT dossiers<br/>(product_id, s3_key, version, active=true, subido_por)
    A->>DB: COMMIT

    A-->>F: 201 {dossier_id, version, created_at}
    F->>U: Toast "Dossier subido - version 2"
```

## Download: pre-signed URL

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuario
    participant F as Frontend
    participant A as API
    participant R2 as R2

    U->>F: En detail lead<br/>Click 'Ver dossier'

    F->>A: GET /api/dossiers/by-product/:product_id/download

    A->>A: verifyToken
    A->>A: projectAccess check
    A->>DB: SELECT dossier WHERE product_id AND active
    DB-->>A: dossier o null

    alt Sin dossier
        A-->>F: 404 NO_DOSSIER
    end

    A->>R2: getSignedUrl<br/>expiresIn: 15min
    R2-->>A: signed_url

    A-->>F: 200 {url, expires_at}

    F->>F: window.open(url, '_blank')
    U->>R2: Descarga directa

    Note over R2: URL expira en 15 min.<br/>Si se copia el link y se<br/>pega despues, no funciona.
```

## Marcar dossier enviado

```mermaid
sequenceDiagram
    participant U as Gestor
    participant F as Frontend
    participant A as API
    participant DB as DB

    U->>F: En detail lead<br/>Click 'Copiar link dossier'
    F->>A: GET /api/dossiers/.../download
    A-->>F: {url}
    F->>F: navigator.clipboard.writeText(url)
    F->>U: Toast "Enlace copiado"

    U->>U: Envia por WhatsApp/email<br/>al lead (manual fuera del CRM)

    U->>F: Marca checkbox<br/>"Dossier enviado"
    F->>A: PATCH /api/leads/:id<br/>{dossier_enviado: true}

    A->>DB: UPDATE leads<br/>SET dossier_enviado = true<br/>dossier_enviado_at = NOW
    A->>DB: INSERT lead_interactions<br/>(tipo=nota, nota='Dossier enviado')

    A-->>F: 200
    F->>F: Refresca timeline
```

## Versionado: historial de dossiers

```mermaid
graph TD
    P[Producto: Master Psicologia]
    P --> V1[Version 1<br/>active=false<br/>2026-01-15<br/>Manuel subio]
    P --> V2[Version 2<br/>active=false<br/>2026-02-20<br/>Diego subio]
    P --> V3[Version 3<br/>active=true<br/>2026-04-01<br/>Diego subio]

    style V3 fill:#22c55e,color:#fff
    style V1 fill:#e5e7eb
    style V2 fill:#e5e7eb
```

- **Siempre hay 1 version activa** por producto (la mas reciente)
- **Las anteriores no se borran** - quedan como historial
- **URLs antiguas siguen funcionando** (R2 key se mantiene)

## Seguridad

```mermaid
flowchart TD
    REQ[Request download]
    REQ --> T1{Tiene JWT valido?}
    T1 -->|NO| E1[401]
    T1 -->|SI| T2{Tiene acceso<br/>al proyecto?}
    T2 -->|NO| E2[403]
    T2 -->|SI| T3{Existe dossier activo?}
    T3 -->|NO| E3[404]
    T3 -->|SI| GEN[Genera URL firmada<br/>expira en 15min]
    GEN --> RET[200 {url}]

    style RET fill:#22c55e
    style E1 fill:#ef4444
    style E2 fill:#ef4444
    style E3 fill:#ef4444
```

## Configuracion R2

```mermaid
graph LR
    subgraph "Cloudflare R2"
        B[Bucket: crm-dossiers]
        B --> K1[dossiers/psiko-aprende/<br/>p1/uuid1.pdf]
        B --> K2[dossiers/iseih/<br/>p4/uuid2.pdf]
    end

    subgraph "Backend env"
        E1[CLOUDFLARE_R2_ACCOUNT_ID]
        E2[CLOUDFLARE_R2_ACCESS_KEY]
        E3[CLOUDFLARE_R2_SECRET_KEY]
        E4[CLOUDFLARE_R2_BUCKET]
    end

    E1 -.-> B
    E2 -.-> B
    E3 -.-> B
    E4 -.-> B
```

## Estado actual

| Feature | Backend | Frontend | R2 |
|---------|---------|----------|-----|
| Upload PDF + versionado | OK | OK (drag&drop) | **PENDIENTE config** |
| Pre-signed URL 15min | OK | OK | - |
| Marcar dossier_enviado en lead | OK | OK | - |
| Historial versiones | OK | OK | - |
| Validacion magic bytes PDF | OK | - | - |
| Max tamano 10MB | OK | OK | - |
| **Creacion bucket R2 en Cloudflare** | - | - | **PENDIENTE** |
| **Config .env con keys R2** | **PENDIENTE** | - | - |
| **Copiar link directo WhatsApp/email** | Parcial (URL funciona) | **PENDIENTE boton dedicado** | - |
