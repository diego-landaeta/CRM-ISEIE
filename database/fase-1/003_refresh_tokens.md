# Migracion 003 - Refresh Tokens

> **Archivo fuente:** `backend/migrations/003_refresh_tokens.sql`
> **Story Jira:** CRM-35 / F1-011

---

## Resumen

Tabla para almacenar refresh tokens hasheados con soporte de revocacion y expiracion.
Cada login genera un refresh token nuevo. Al hacer refresh se rota (viejo se revoca, nuevo se crea).
Al hacer logout se revoca el token activo.

## Tabla creada

| Tabla | Campos | Proposito |
|-------|--------|-----------|
| user_refresh_tokens | id, user_id (FK), token_hash (UNIQUE), expires_at, revoked, created_at | Almacena refresh tokens hasheados con SHA256 |

## Indices

| Indice | Columnas | Para que |
|--------|----------|----------|
| idx_refresh_tokens_user_id | user_id | Revocar todos los tokens de un usuario |
| idx_refresh_tokens_hash | token_hash WHERE revoked = false | Buscar token activo rapidamente |

---

## SQL Ejecutado

```sql
-- ============================================================
-- Migracion 003: Tabla refresh tokens
-- Ticket: CRM-35 / F1-011
-- Depende de: 001 (users)
-- ============================================================

BEGIN;

CREATE TABLE user_refresh_tokens (
    id          SERIAL       PRIMARY KEY,
    user_id     INTEGER      NOT NULL,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ  NOT NULL,
    revoked     BOOLEAN      NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_refresh_tokens_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_refresh_tokens_user_id ON user_refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_hash ON user_refresh_tokens (token_hash) WHERE revoked = false;

COMMIT;
```

---

## Ejecuciones

### crm_test_db (staging)
- **Fecha:** 2026-04-06
- **Resultado:** OK - 1 tabla, 2 indices
- **Ejecutado por:** Claude via SSH

### crm_db (produccion)
- **Fecha:** 2026-04-06
- **Resultado:** OK - 1 tabla, 2 indices
- **Ejecutado por:** Claude via SSH
