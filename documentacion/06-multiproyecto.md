# 06. Multi-Proyecto (Equipos)

## Concepto

Un usuario puede pertenecer a varios proyectos con un orden de cola definido (para round-robin). El superadmin gestiona a quien va que proyecto.

## ERD del sistema multi-proyecto

```mermaid
erDiagram
    users ||--o{ user_projects : "trabaja en"
    projects ||--o{ user_projects : "tiene equipo"
    projects ||--o{ project_queue_state : "cola round-robin"

    users {
        int id PK
        string nombre
        string email UK
        enum role
        bool active
    }

    projects {
        int id PK
        string nombre
        string slug UK
        enum type "crm/ia"
        string webhook_api_key
        int dias_alerta_inactividad
        bool active
    }

    user_projects {
        int id PK
        int user_id FK
        int project_id FK
        int orden_cola "orden en round-robin"
        bool active
    }

    project_queue_state {
        int id PK
        int project_id FK UK
        int last_assigned_user_id FK
        int last_assigned_index
        timestamp updated_at
    }
```

## Relacion usuarios-proyectos

```mermaid
graph TB
    subgraph "Usuarios"
        M[Manuel<br/>superadmin]
        D[Diego<br/>admin]
        A[Angel<br/>admin]
        L[Laura<br/>gestor]
        C[Carlos<br/>gestor]
    end

    subgraph "Proyectos CRM"
        P1[Psiko Aprende]
        P2[ISEIH]
        P3[Fono Aprende]
    end

    subgraph "Proyectos IA"
        P4[Psicologo IA]
        P5[Nutricionista IA]
        P6[Tarot IA]
    end

    M -.->|ve todo| P1
    M -.->|ve todo| P2
    M -.->|ve todo| P3
    M -.->|ve todo| P4

    D -->|orden 1| P1
    D -->|orden 1| P2

    A -->|orden 2| P1
    A -->|orden 1| P3

    L -->|orden 3| P1
    L -->|orden 2| P2

    C -->|orden 4| P1
    C -->|orden 2| P3

    style M fill:#dc2626,color:#fff
    style D fill:#3b82f6,color:#fff
    style A fill:#3b82f6,color:#fff
    style L fill:#6b7280,color:#fff
    style C fill:#6b7280,color:#fff
```

Lectura: Diego esta en Psiko(orden 1) e ISEIH(orden 1). Angel en Psiko(orden 2) y Fono(orden 1). Laura en Psiko(orden 3) e ISEIH(orden 2). Etc.

## Flujo: asignar proyecto a usuario

```mermaid
sequenceDiagram
    autonumber
    participant SA as Superadmin
    participant F as Frontend
    participant A as API
    participant DB as DB

    SA->>F: Settings > Usuarios > click "Editar Laura"
    F->>A: GET /api/users/:id
    A->>DB: findById + getUserProjects
    DB-->>A: user + project_ids[1, 2]
    A-->>F: {user, projects}

    F->>F: Muestra checkboxes proyectos<br/>con los asignados marcados

    SA->>F: Marca tambien proyecto 3 (Fono)
    F->>A: PATCH /api/users/:id<br/>{projectIds: [1, 2, 3]}

    A->>DB: BEGIN
    A->>DB: UPDATE user_projects SET active=false<br/>WHERE user_id = Laura
    loop Para cada projectId
        A->>DB: INSERT user_projects<br/>ON CONFLICT UPDATE active=true<br/>orden_cola = MAX+1
    end
    A->>DB: COMMIT

    A-->>F: 200 user actualizado
```

## Round-robin por proyecto

Cada proyecto tiene su propio state. No interfieren entre si.

```mermaid
graph LR
    subgraph "project_queue_state"
        S1[project_id=1<br/>last_assigned_index=2]
        S2[project_id=2<br/>last_assigned_index=0]
        S3[project_id=3<br/>last_assigned_index=1]
    end

    subgraph "Psiko: [Diego, Angel, Laura, Carlos]"
        N1[Siguiente: Carlos<br/>index 3]
    end

    subgraph "ISEIH: [Diego, Laura]"
        N2[Siguiente: Laura<br/>index 1]
    end

    subgraph "Fono: [Angel, Carlos]"
        N3[Siguiente: Angel<br/>index 0]
    end

    S1 --> N1
    S2 --> N2
    S3 --> N3
```

## Que ve cada rol en el sidebar

```mermaid
flowchart TB
    USER[Usuario autenticado]
    USER --> ROLE{role?}

    ROLE -->|superadmin| SA[Ve TODOS los proyectos<br/>+ selector 'Todos los proyectos']
    ROLE -->|admin| AD[Ve TODOS sus proyectos<br/>selector por proyecto]
    ROLE -->|gestor| GE[Ve SUS proyectos<br/>selector por proyecto]

    SA --> SEL[ProjectSelector en navbar]
    AD --> SEL
    GE --> SEL

    SEL --> CTX[ProjectContext activeProjectId]
    CTX --> API[Todas las queries<br/>incluyen ?projectId=X]
```

## Filtrado de datos por proyecto activo

```mermaid
sequenceDiagram
    participant F as Frontend
    participant CTX as ProjectContext
    participant API as API
    participant DB as DB

    F->>CTX: user cambia proyecto activo
    CTX->>CTX: activeProjectId = 2<br/>localStorage.set
    CTX->>F: emite cambio

    F->>API: GET /api/leads?projectId=2

    Note over API: Middleware projectAccess
    API->>DB: SELECT 1 FROM user_projects<br/>WHERE user_id = ? AND project_id = 2 AND active
    alt No tiene acceso
        API-->>F: 403 PROJECT_FORBIDDEN
    end

    API->>DB: SELECT leads WHERE project_id = 2
    DB-->>API: leads
    API-->>F: data
```

## Superadmin: caso especial

El superadmin en el PDF puede ver TODO sin estar asignado. Actualmente:

```js
// projectAccess.js
if (req.user.role === 'superadmin') {
  req.projectId = Number(projectId);
  return next();  // bypass check
}
```

Para ver TODOS los proyectos (sin filtrar), el superadmin puede:
- Dejar `projectId` vacio en algunos endpoints (PENDIENTE implementar)
- O tener un selector especial "Todos los proyectos" en el navbar (PENDIENTE)

## Casos de uso

```mermaid
flowchart TD
    C1[Superadmin crea gestor nuevo Maria]
    C1 --> A1[POST /api/users<br/>projectIds: 1, 2]
    A1 --> A2[Envia email con set_password]
    A2 --> C2[Maria entra al sistema]
    C2 --> A3[Ve solo Psiko e ISEIH]
    A3 --> A4[Recibe leads automaticos<br/>por round-robin]

    C3[Leads de Psiko empiezan a sobrecargarse]
    C3 --> A5[Admin agrega Carlos<br/>a Psiko]
    A5 --> A6[Carlos entra en la cola<br/>orden_cola = MAX+1]
    A6 --> A7[Se distribuye mejor]

    C4[Laura se va de la empresa]
    C4 --> A8[Superadmin desactiva cuenta]
    A8 --> A9[Se revocan refresh tokens]
    A9 --> A10[Ya no entra al sistema]
    A10 --> A11[Round-robin salta su turno]
    A11 --> A12[Sus leads siguen asignados<br/>hasta reasignar manualmente]
```
