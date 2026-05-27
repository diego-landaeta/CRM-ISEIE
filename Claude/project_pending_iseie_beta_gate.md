---
name: project-pending-iseie-beta-gate
description: "Aplicar beta gate al sidebar de CRM-ISEIE — secciones no listas deben mostrar \"PRÓXIMAMENTE\""
metadata: 
  node_type: memory
  type: project
  originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---

**Pendiente para CRM-ISEIE** (no hacer todavía; el user dijo "lo hacemos al conectar el WordPress" — 2026-05-27).

**Contexto:** El CRM hermano (esos2dev-oss/CRM) tiene un sistema de beta gate en `frontend/src/shared/config/betaConfig.ts` que oculta o marca como "PRÓXIMAMENTE" rutas no listas en producción (controlado por `VITE_BETA_MODE=true` en `.env.production`). Items como "Email", "Documentos" aparecen atenuados con badge.

**En CRM-ISEIE (https://crm.iseie.com)** el sidebar muestra TODAS las secciones activas sin ningún gate. Los items como Contabilidad (Dashboard, Ventas, Ingresos, Conversiones, Egresos, Cuentas por cobrar/pagar, Comisiones, Nóminas), Análisis, etc. deberían marcarse como "PRÓXIMAMENTE" hasta que estén realmente operativas.

**Qué hay que portar:**
1. `frontend/src/shared/config/betaConfig.ts` desde CRM hermano (con allowlist propia de ISEIE — solo activar lo que está realmente operativo)
2. `frontend/.env.production` con `VITE_BETA_MODE=true`
3. La lógica en `Sidebar.jsx`/`AppLayout.jsx` que usa `isBetaAllowed()` para gris-atenuar items no allowlisted
4. Reglas tipo `<AllProjectsGuard>` si aplican

**Cuándo:** después de conectar WordPress y validar la importación de páginas (próximo hito).

**Quién decide qué allowlist:** Manuel/Diego. Mientras tanto, lo apropiado es allowlist mínimo (Prospectos + Clientes + Productos + Configuración) y todo lo demás "PRÓXIMAMENTE".
