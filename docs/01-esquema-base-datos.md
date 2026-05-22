# 01 — Esquema de base de datos

> **Fuente de verdad ejecutable:** [`backend/migrations/001_initial_schema.sql`](../backend/migrations/001_initial_schema.sql).
> Este documento la explica en prosa. Si hay desacuerdo, gana el SQL.

---

## Convenciones

- Motor: **PostgreSQL 15+**.
- Naming: tablas en `snake_case` plural, columnas en `snake_case`, FKs `<tabla>_id`.
- Timestamps: `TIMESTAMPTZ` con `DEFAULT NOW()`. Nunca `TIMESTAMP` sin zona.
- Soft-delete: columna `deleted_at TIMESTAMPTZ NULL` + índice parcial `WHERE deleted_at IS NULL`. Aplica solo a entidades donde está justificado (de momento solo `leads`).
- Trigger global `set_updated_at()` se aplica automáticamente a toda tabla que tenga columna `updated_at` (se instala al final de la migración 001).
- Idempotency: tablas que reciben datos de fuentes externas (`leads`) tienen `idempotency_key` con UNIQUE parcial por proyecto.
- Owner: en el CRM hermano las tablas se asignan al rol `crm_user`. En CRM-ISEIE usamos `crm_iseie_user`. Si replicas migraciones del hermano cuidado con `ALTER TABLE … OWNER TO crm_user` — sustituye el rol.

---

## Cómo nace este esquema

La 001 del CRM hermano + 60+ ALTERs posteriores se condensan en una sola migración inicial para **arrancar limpio**. Lo que se consolida:

| Migración hermano | Cambio fusionado en `001_initial_schema.sql` |
|---|---|
| `001_initial_schema.sql` | Esqueleto base: enums + 14 tablas core |
| `003_refresh_tokens.sql` | Tabla `user_refresh_tokens` |
| `014_user_avatar.sql` | `users.avatar_url`, `users.avatar_key` |
| `015_project_modules.sql` | `projects.modules` JSONB |
| `026_role_soporte.sql` | `user_role` += `'soporte'` |
| `029_user_views.sql` | Tabla `user_views` |
| `033_roles_permissions.sql` | Tablas `custom_roles`, `user_permission_overrides`, FK `users.custom_role_id` |
| `040_role_views.sql` | `custom_roles.default_view` JSONB |
| `044_sidebar_labels.sql` | `projects.sidebar_labels` JSONB |
| `045_theme_color.sql` | `projects.theme_color` |
| `056_add_whatsapp_canal.sql` | `utm_channel` += `'whatsapp'` |
| `057_user_availability.sql` | `users.is_available/unavailable_*`, tabla `user_availability_blocks`, `leads.idempotency_key` |
| `058_leads_soft_delete.sql` | `leads.deleted_at` |
| `059_leads_propuesto.sql` | `leads.propuesto` |
| `055_leads_email_nullable.sql` | `leads.email` sin NOT NULL |

Cualquier ALTER posterior del CRM hermano que toque entidades NO-core (matrículas, payroll, woocommerce, dossiers avanzados, email-sequences, audiences, ia-reports, documents, etc.) **no se fusiona** aquí — se añadirá como migración separada cuando se replique cada módulo (`002_…`, `003_…`).

---

## Tipos ENUM

| Nombre | Valores |
|---|---|
| `user_role` | `superadmin`, `admin`, `gestor`, `soporte` |
| `project_type` | `crm`, `ia` |
| `lead_status` | `nuevo`, `por_contactar`, `contactado`, `en_seguimiento`, `convertido`, `no_interesado` |
| `interaction_type` | `llamada`, `email`, `whatsapp`, `nota` |
| `payment_method` | `transferencia`, `tarjeta`, `efectivo`, `fraccionado` |
| `utm_channel` | `meta_ads`, `google_ads`, `tiktok_ads`, `organico`, `chatgpt_ia`, `directo`, `referido`, `whatsapp` |
| `api_service` | `meta`, `google_ads`, `gsc`, `stripe`, `claude`, `brevo` |

**Política para añadir valores a un enum:** migración propia con `ALTER TYPE … ADD VALUE IF NOT EXISTS …`. Postgres no soporta `ADD VALUE` dentro de una transacción explícita en versiones < 12; en 15+ ya sí. Mantener cada `ADD VALUE` en su propio archivo de migración para que sea fácil de revertir conceptualmente.

---

## Tablas — vista de alto nivel

### Auth & usuarios

| Tabla | Propósito |
|---|---|
| `users` | Cuenta de usuario del CRM. `role` (enum nativo) + opcional `custom_role_id` (FK a `custom_roles`). |
| `custom_roles` | Roles personalizados con `permissions` JSONB + `default_view` JSONB. |
| `user_permission_overrides` | Override fino por usuario (resource + action → allowed/denied). |
| `user_refresh_tokens` | Refresh tokens hasheados con expiración. Soporta revocación. |
| `user_availability_blocks` | Bloques programados de ausencia (vacaciones, formación). Round-robin los respeta. |
| `user_views` | Preferencias de UI por usuario, globales o por proyecto. |
| `user_activity_log` | Auditoría libre (acción + JSONB de detalles + IP). |

**Cadena de chequeo de permisos** (replicar tal cual del CRM hermano, ver `src/shared/middleware/auth.js` y `permissions.js`):

1. Override de usuario (`user_permission_overrides`) gana sobre todo.
2. Si tiene `custom_role_id`, su `permissions` JSONB define.
3. Fallback al `role` nativo (matriz cableada por defecto).

### Proyectos (multi-tenant)

| Tabla | Propósito |
|---|---|
| `projects` | Tenant del CRM. `type` decide pipeline de leads (`'crm'`) o solo suscripciones (`'ia'`). `modules` JSONB activa/desactiva funcionalidades por tenant. `theme_color` + `sidebar_labels` permiten branding ligero. |
| `user_projects` | M:N usuario-proyecto. `orden_cola` define el orden en el round-robin. `active=false` saca al gestor de la cola sin desasignarlo. |
| `project_queue_state` | Cursor del round-robin por proyecto (último user_id asignado e índice). Modificado dentro de la transacción de asignación. |

### Pipeline de leads

| Tabla | Propósito |
|---|---|
| `leads` | Entrada principal. `responsable_id` se asigna por round-robin o manualmente. `idempotency_key` evita duplicados de webhooks. `deleted_at` para soft-delete. `propuesto=true` significa creado manualmente por gestor. |
| `lead_utms` | 1:1 con leads. UTMs + `canal_detectado`. |
| `lead_status_history` | Append-only de transiciones de status (auditoría). |
| `lead_interactions` | Llamadas / emails / whatsapps / notas por lead. |
| `lead_reminders` | Recordatorios programados. El cron `reminderScheduler` (a replicar) envía email cuando `fecha_recordatorio <= CURRENT_DATE`. |

### Productos & dossiers

| Tabla | Propósito |
|---|---|
| `products` | Catálogo por proyecto. Versión inicial mínima. Se ampliará en `002_…` (categorías, precios, modalidad, etc.) cuando se replique el módulo `products` del hermano. |
| `dossiers` | PDFs por producto. Versionado (`version`). `s3_key` apunta a R2. URLs servidas como pre-signed con 15 min de TTL. |

### Conversiones & pagos

| Tabla | Propósito |
|---|---|
| `conversions` | Venta. `importe_total` vs `importe_pagado`. `metodo_pago='fraccionado'` => abonos en `conversion_payments`. |
| `conversion_payments` | Abonos parciales. La suma debe coincidir con `conversions.importe_pagado` (regla de servicio, no constraint DB — el hermano lo hace en `conversion.service`). |

---

## Round-robin de asignación de leads

Replica literal del patrón del CRM hermano (`lead.service.js`):

```text
BEGIN;
  SELECT user_id FROM user_projects
   WHERE project_id = $1
     AND active = true
     AND user_id IN (
       SELECT id FROM users
        WHERE active = true
          AND is_available = true
          AND id NOT IN (
            SELECT user_id FROM user_availability_blocks
             WHERE CURRENT_DATE BETWEEN fecha_inicio AND fecha_fin
          )
     )
   ORDER BY orden_cola
   FOR UPDATE;  -- bloqueo optimista

  -- pick = el siguiente al cursor en project_queue_state
  UPDATE project_queue_state SET last_assigned_user_id = $pick,
                                  last_assigned_index   = $idx,
                                  updated_at = NOW()
   WHERE project_id = $1;

  INSERT INTO leads (..., responsable_id) VALUES (..., $pick);
COMMIT;
```

Reglas clave:

- La selección de gestor candidato + el update del cursor + el insert del lead **están en la misma transacción** para evitar dobles asignaciones bajo concurrencia.
- Si no hay gestores disponibles, el lead queda con `responsable_id = NULL` y aparece como "sin asignar" en la UI. No se rechaza.
- `is_available=false` o un bloque activo de `user_availability_blocks` saca al gestor de la rotación pero **no** lo desasigna de los leads existentes.

---

## Trigger global `updated_at`

La 001 instala `set_updated_at()` y, mediante un `DO $$ FOR LOOP $$`, lo asocia a TODAS las tablas que tengan columna `updated_at` en `information_schema.columns` del schema `public`. **Cualquier tabla nueva con columna `updated_at` que se cree en una migración posterior debe instalar su propio trigger** (copy-paste del bloque `CREATE TRIGGER trg_<tabla>_updated_at …`). No volvemos a correr el `DO` global porque ya estarían duplicados los triggers existentes.

---

## Política de migraciones

1. **Una migración = una intención clara.** No batch de cambios no relacionados.
2. **Nombrado:** `NNN_descripcion-snake.sql`.
3. **Idempotentes cuando sea posible** (`IF NOT EXISTS`, `CREATE OR REPLACE`). Para migraciones de schema "primera vez" no hace falta.
4. **`BEGIN; … COMMIT;` siempre.** Si una migración necesita comportamiento no-transaccional (ej. `ALTER TYPE … ADD VALUE` en algunas versiones), aislar en archivo propio.
5. **Cambios destructivos** (`DROP`, `ALTER TABLE … DROP COLUMN`) requieren backup previo documentado y entrada explícita en el commit message.
6. **Owner:** tras crear tabla, `ALTER TABLE … OWNER TO crm_iseie_user`. Lo mismo para sequences. (Esto solo importa si el script se ejecuta como `postgres` superuser; si se ejecuta como `crm_iseie_user` directamente, el owner ya es correcto.)
7. **Aplicación:** se hará con `psql` directo (sin runner ORM). Cuando se replique el módulo correspondiente del hermano se puede portar un mini-runner si compensa.

---

## Cómo aplicar la 001 (cuando llegue el momento)

> **No ejecutar todavía.** Pendiente de instalar PostgreSQL en el VPS y crear DB + usuario (ver [`vps-72.60.90.135-handoff.md`](../vps-72.60.90.135-handoff.md) §5.2).

```bash
# En el VPS (cuando estemos listos):
sudo -u postgres psql -c "CREATE USER crm_iseie_user WITH PASSWORD '<pass>';"
sudo -u postgres psql -c "CREATE DATABASE crm_iseie OWNER crm_iseie_user;"

# Aplicar la migración
psql -U crm_iseie_user -d crm_iseie -h localhost \
     -f backend/migrations/001_initial_schema.sql
```

Para desarrollo local (Windows) — pendiente de decidir si instalamos Postgres local o desarrollamos contra el del VPS por túnel SSH. Por ahora la migración solo existe como artefacto en el repo.

---

## Pendiente de decidir

- **Owner final** de tablas: ¿`crm_iseie_user` mantiene ownership o lo dejamos a `postgres` y damos GRANTs?
- **Extensiones**: ¿`uuid-ossp`, `pg_trgm`, `pgcrypto`? El hermano no las usa hoy pero `pg_trgm` ayudaría a búsquedas de leads por nombre/email.
- **Datos seed**: ¿qué proyecto inicial creamos para ISEIE? Slug, nombre, theme color, módulos activos.
- **Modo IA vs CRM**: ¿algún proyecto ISEIE va a ser `type='ia'` o todos `'crm'`? Hoy estoy asumiendo solo `'crm'`.
