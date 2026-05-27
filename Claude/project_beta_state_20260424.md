---
name: BETA state 2026-04-24
description: Estado de la DB staging tras reset para BETA, 2 proyectos vigentes, configuracion base
type: project
originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---
BETA arrancado 2026-04-24 con DB staging reseteada y datos minimos.

**Proyectos vigentes (crm_test_db, solo 2):**
- id=1 Psiko Aprende (type=crm, producto_label=Formacion/Formaciones)
- id=4 Psicologo IA (type=ia, producto_label=Plan/Planes)

**Proximos proyectos se añaden MANUALMENTE uno a uno.** Usuario prefiere esto para fase 1.

**Usuarios activos (password: `<<VPS_ROOT_PASS — ver credenciales fuera de repo>>`):**
- manuel@empresa.com (superadmin)
- diego@empresa.com (admin)
- angel@empresa.com (admin)
- laura@empresa.com (gestor)
- carlos@empresa.com (gestor)

**Gestoras asignadas a Psiko Aprende**: Laura + Carlos.

**Script idempotente:** `backend/seeds/reset_beta.sql` — regenera este estado en otro servidor si hace falta duplicar el setup.

**Webhook keys regeneradas:**
- whk_psiko_{random}
- whk_psicoia_{random}

**Why:** empezar BETA sin ruido de los datos de test. Los usuarios usa emails @empresa.com (no @iseih.com como creiamos antes).

**How to apply:** si necesita replicar el staging en otro server, ejecutar el reset_beta.sql tras las migraciones 001-013. Si crea proyectos nuevos, solo superadmin puede via UI o endpoint POST /api/projects.
