# 04. Flujo de Autenticacion

## Login

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuario
    participant F as Frontend React
    participant A as API Express
    participant DB as PostgreSQL
    participant BR as Brevo<br/>(solo set-password)

    U->>F: Email + password
    F->>A: POST /api/auth/login<br/>{email, password}

    A->>A: Valida Zod schema
    A->>DB: SELECT * FROM users WHERE email = ?
    DB-->>A: user

    alt Usuario no existe
        A-->>F: 401 INVALID_CREDENTIALS
    end

    alt user.active = false
        A-->>F: 403 ACCOUNT_DISABLED
    end

    A->>A: bcrypt.compare(password, user.password_hash)
    alt Password incorrecta
        A-->>F: 401 INVALID_CREDENTIALS
    end

    A->>DB: SELECT proyectos de usuario<br/>(user_projects + projects)
    DB-->>A: projects[]

    A->>A: sanitizeProjects(projects, role)<br/>Oculta webhook_api_key si es gestor

    A->>A: generateAccessToken (JWT 15min)<br/>generateRefreshToken (40 bytes)

    A->>DB: INSERT user_refresh_tokens<br/>(hash sha256 del token)
    A->>DB: UPDATE users SET last_login_at = NOW()
    A->>DB: INSERT user_activity_log<br/>(action = 'login', ip)

    A-->>F: 200 + accessToken + refreshToken<br/>Set-Cookie: refreshToken httpOnly
    F->>F: Guarda accessToken en memoria<br/>(no localStorage)

    F-->>U: Redirect a /dashboard
```

## Refresh automatico (cuando accessToken expira)

```mermaid
sequenceDiagram
    autonumber
    participant F as Frontend
    participant A as API
    participant DB as DB

    F->>A: GET /api/leads<br/>Authorization: Bearer {accessToken}
    A->>A: Verifica JWT
    alt Token expirado
        A-->>F: 401 TOKEN_EXPIRED
    end

    Note over F: Interceptor detecta 401

    F->>A: POST /api/auth/refresh<br/>Cookie: refreshToken
    A->>A: hash(refreshToken)
    A->>DB: SELECT user_refresh_tokens<br/>WHERE token_hash = ?
    DB-->>A: storedToken

    alt Token no existe o revoked
        A-->>F: 401 REFRESH_INVALID<br/>(Logout forzado)
    end

    alt Token expirado (>30d)
        A->>DB: UPDATE revoked = true
        A-->>F: 401 REFRESH_EXPIRED
    end

    A->>DB: UPDATE revoked = true<br/>(rotacion: invalida el viejo)
    A->>A: Genera nuevo refreshToken
    A->>DB: INSERT nuevo refresh_token

    A->>A: Genera nuevo accessToken

    A-->>F: 200 + nuevo accessToken<br/>Set-Cookie: nuevo refreshToken

    F->>A: Reintenta GET /api/leads<br/>con nuevo accessToken
    A-->>F: 200 data
```

## Logout

```mermaid
sequenceDiagram
    participant U as Usuario
    participant F as Frontend
    participant A as API
    participant DB as DB

    U->>F: Click Logout
    F->>A: POST /api/auth/logout<br/>Cookie: refreshToken<br/>Auth: Bearer accessToken

    A->>A: verifyToken middleware
    A->>DB: UPDATE user_refresh_tokens<br/>SET revoked = true<br/>WHERE token_hash = ?
    A->>DB: INSERT user_activity_log<br/>(action = 'logout')

    A-->>F: 200 OK<br/>Set-Cookie: refreshToken (expired)
    F->>F: accessToken = null<br/>user = null
    F-->>U: Redirect /login
```

## Set Password (primer login / reset)

```mermaid
sequenceDiagram
    autonumber
    participant A as Admin/SA
    participant API as API
    participant DB as DB
    participant BR as Brevo
    participant U as Usuario nuevo
    participant F as Frontend

    A->>API: POST /api/users<br/>{nombre, email, role, projectIds}
    API->>API: Genera random hex tokens<br/>- password temporal (32 bytes)<br/>- set_password_token (32 bytes)

    API->>DB: INSERT users<br/>password_hash = bcrypt(temp)<br/>set_password_token = hash(raw)<br/>set_password_expires = +24h

    API->>DB: INSERT user_projects[...]<br/>con orden_cola incremental

    API->>BR: send email<br/>link: /set-password?token={raw}
    API-->>A: 201 user creado

    BR->>U: Email con link

    U->>F: Click link
    F->>F: Extrae token de URL
    U->>F: Escribe password nueva + confirm
    F->>API: POST /api/auth/set-password<br/>{token, password, confirmPassword}

    API->>API: Zod valida fuerza password<br/>(>=8, 1 mayuscula, 1 numero)
    API->>DB: SELECT WHERE set_password_token = hash(token)
    DB-->>API: user o null

    alt Token invalido o ya usado
        API-->>F: 400 TOKEN_INVALID
    end

    alt Token expirado (>24h)
        API-->>F: 400 TOKEN_EXPIRED
    end

    API->>DB: UPDATE users<br/>password_hash = bcrypt(nueva)<br/>set_password_token = NULL<br/>set_password_expires = NULL

    API->>DB: INSERT user_activity_log<br/>(action = 'set_password')

    API-->>F: 200 OK
    F-->>U: Redirect /login
```

## Almacenamiento de tokens

```mermaid
graph TB
    subgraph Frontend
        MEM[accessToken en memoria JS<br/>Se pierde al refrescar pagina]
        COOKIE[refreshToken httpOnly cookie<br/>Secure + SameSite=strict<br/>path=/api/auth]
    end

    subgraph Backend DB
        RT[user_refresh_tokens<br/>token_hash SHA256<br/>expires_at +30d<br/>revoked boolean]
    end

    MEM -.->|Authorization header| API[API]
    COOKIE -.->|Cookie header<br/>solo en /api/auth/*| API
    API -.->|compara hash| RT
```

## Por que no localStorage?

| Opcion | Seguridad | Persistencia | Eleccion |
|--------|-----------|--------------|----------|
| localStorage | Vulnerable a XSS | Si | NO |
| sessionStorage | Vulnerable a XSS | Solo tab actual | NO |
| Cookie httpOnly | Segura (no accesible JS) | Si (hasta expiry) | **SI para refresh** |
| Memoria JS | Segura (muere al cerrar) | No | **SI para access** |

El access token se pierde al refrescar la pagina, pero el refresh cookie sigue. Al cargar la app, `AuthContext` hace un refresh automatico para obtener un nuevo access token.

## Desactivar usuario = cerrar sesion

Segun PDF spec: al desactivar un usuario, su sesion activa debe cerrarse inmediatamente.

**PENDIENTE**: cuando admin llama `DELETE /api/users/:id`, actualmente solo marca `active = false`. Hay que tambien:

```sql
UPDATE user_refresh_tokens
SET revoked = true
WHERE user_id = {id} AND revoked = false;
```

Al siguiente refresh request, el backend retorna 401 USER_INVALID y el frontend lo expulsa.
