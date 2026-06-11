# EPIC B — Egresos / Gastos (3 días)

**Rama**: `feat/finanzas-sprint1`
**Objetivo**: Manuel puede registrar gastos por proyecto con categoría + comprobante PDF/imagen, verlos en tabla filtrable, exportarlos a CSV.

---

## Estado inicial (auditoría A.3)

| | ISEIE | ISEIH |
|---|---|---|
| Tabla `expenses` registros | 0 | 0 |
| Schema | ya existe (`docs/17` A.3) | ya existe |
| Enum `expense_category` | 9 valores | 9 valores |
| Backend | controller + model + routes + validation | dentro de `accounting/` (divergencia) |
| Frontend | módulo `expenses/` | módulo `accounting/` |

**Valores enum actuales**: salarios, alquiler, proveedores, software, publicidad, impuestos, servicios, mantenimiento, otros.

---

## Fases (5)

### Fase B.1 — Migraciones (~30 min)

- [ ] ALTER TYPE `expense_category` ADD VALUE: `comision_pasarela_pago` (Stripe fees, EPIC B0), `comision_gestor` (pago de comisión, EPIC F), `nomina` (pago de nómina, EPIC F)
- [ ] ALTER TABLE `expenses` ADD columnas:
  - `comprobante_url TEXT` — URL al archivo
  - `comprobante_key VARCHAR(500)` — key del storage (local o S3)
  - `comprobante_mime VARCHAR(50)`
  - `comprobante_size_bytes INTEGER`
  - `source_payable_id INTEGER UNIQUE` — origen automático (hook C → expense, evita duplicados)
  - `source_stripe_payout_id VARCHAR(100) UNIQUE` — origen automático (hook B0 → expense)
- [ ] Verificar índices: ya hay sobre fecha y project_id. OK.

**Commit**: `feat(epic-b): migration 081/082 categorías nuevas + columnas comprobante/source`

---

### Fase B.2 — Backend: service + endpoint upload (~3h)

- [ ] Crear `backend/src/modules/expenses/expense.service.js` (ISEIE) — refactor de la lógica del controller hacia service. Punto donde luego enganchamos hooks B0/C/F.
- [ ] **ISEIH** (divergencia): el módulo de expenses vive bajo `accounting/`. Cualquier cambio del lado backend ahí — replicar.
- [ ] Endpoint `POST /api/expenses/upload-comprobante` (ISEIE) o `/api/accounting/expenses/upload-comprobante` (ISEIH) usando multer:
  - Acepta PDF/JPG/PNG/WEBP, máx 15 MB
  - Guarda en `/opt/crm*/uploads/expenses/` con key `expense-{id}-{hash}.{ext}`
  - Devuelve `{ comprobante_url, comprobante_key, comprobante_mime, comprobante_size_bytes }` para que el form los guarde al crear el egreso
- [ ] Endpoint `GET /api/expenses/:id/comprobante` (descarga con auth) — usa patrón existente de `documents.controller.js → getLocal`.
- [ ] CRUD `POST /api/expenses` valida `categoria` contra el enum (Zod) + admite los campos nuevos.
- [ ] `expense.validation.js`: actualizar enum Zod con las 12 categorías (9 viejas + 3 nuevas).
- [ ] Tests `vitest` del service: insert con/sin comprobante, soft-validation de fecha futura permitida (gastos previstos).

**Commit(s)**:
- `feat(epic-b): backend expense.service.js + endpoint upload comprobante`
- `feat(epic-b): validación categorías nuevas`

---

### Fase B.3 — Frontend: página + dialog con dropzone (~4h)

- [ ] `frontend/src/modules/expenses/pages/ExpensesPage.tsx` (ISEIE) / `accounting/pages/AccountsPayablePage.tsx` equivalente:
  - Tabla con columnas: fecha, categoría (chip), concepto, importe, proyecto, comprobante (icono link si hay), creado por, acciones
  - Filtros: mes/año, categoría multi-select, proyecto, búsqueda por concepto
  - Botón "+ Nuevo egreso" → abre dialog
  - Botón "Export CSV" del mes filtrado
- [ ] `ExpenseFormDialog.tsx`:
  - Campos: concepto, importe (numeric con 2 decimales), fecha (date picker, default hoy), categoría (dropdown 12 valores), proyecto, notas
  - **Dropzone** comprobante con preview (igual patrón que documents)
  - Validación: importe > 0, fecha ≤ hoy + 1 año, concepto ≥ 3 chars
- [ ] `ExpenseRowActions.tsx`: editar inline / eliminar (con confirm + motivo)
- [ ] `expenses.api.ts` con axios — abstraer endpoint por CRM:
  ```ts
  const EXPENSES_ENDPOINT = import.meta.env.VITE_CRM_KIND === 'iseih'
    ? '/accounting/expenses' : '/expenses';
  ```
- [ ] Activar `/expenses` en `betaConfig.ts` (quitar "PRÓX." del sidebar)

**Commit(s)**:
- `feat(epic-b): ExpensesPage + ExpenseFormDialog + dropzone comprobante`
- `feat(epic-b): activar /expenses en BETA_ROUTES`

---

### Fase B.4 — Export CSV + smoke (~1h)

- [ ] `GET /api/expenses?export=csv` → devuelve CSV con BOM UTF-8 para Excel (mismo patrón que Wasapi export)
- [ ] Test manual: registrar 3 egresos reales (alquiler ene, software feb, otros mar), verificar tabla + export
- [ ] Test casos borde: importe con coma vs punto, fecha futura, sin comprobante, categoría auto-generada (comision_*, nomina)
- [ ] Logs limpios en PM2

**Commit**: `feat(epic-b): export CSV con BOM UTF-8 + tests manuales`

---

### Fase B.5 — Deploy + cierre épica (~30 min)

- [ ] Deploy backend ambos VPS + pm2 restart
- [ ] Deploy frontend ambos
- [ ] HTTP 200 en /api/health ambos
- [ ] Smoke: GET /api/expenses + POST /api/expenses con un caso real
- [ ] **NO mergear a main todavía** — esperamos a tener al menos hasta EPIC D para el primer merge consolidado (mejor rollback)
- [ ] Tag interno en rama: `git tag epic-b-done`

**Commit**: `chore(epic-b): cierre épica B + tag epic-b-done`

---

## Matriz de no-regresión EPIC B

| Panel / sistema | Verificación |
|---|---|
| `/conversions` listado | smoke GET responde 200 con datos. Sin cambios visuales. |
| `/sales` (Dashboard + Nueva venta) | `top-products` sigue OK. RegisterSaleDialog con cuotas (fix de ayer) sigue OK. |
| `/accounting/dashboard` | card "egresos del mes" suma las nuevas filas si las hay |
| `/clientes`, `/leads`, `/matriculas` | sin cambios |
| WC sync (cron 30 min) | logs PM2 sin errores nuevos |
| Reminder scheduler | sin errores nuevos |
| Email sequences | siguen disparando para `conversion_created` |
| Notif bell para gestoras | sigue funcionando (fix de ayer) |
| Filtros próximo contacto | sigue OK (fix de ayer) |
| Pipeline cards próximo contacto | sigue OK |

---

## Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| ALTER TYPE en enum bloquea por minutos en tablas grandes | `expenses` tiene 0 filas → instant |
| Multer rompe el body parser global | Aplicar solo a la ruta `/upload-comprobante` con middleware específico |
| Upload de 15 MB satura nginx | Verificar `client_max_body_size` en Nginx config (ya está en 25M por documents) |
| Frontend CRM-kind abstraction se rompe | Test con superadmin en ambos CRMs antes de mergear |
| Categorías auto-generadas (B0/F) duplican expenses | UNIQUE en `source_*_id` evita duplicados |

---

## Lo que esta épica NO hace

- ❌ Sincronización con bancos (Sprint 2)
- ❌ OCR de comprobantes (Sprint 2)
- ❌ Categorización automática por concepto (Sprint 2)
- ❌ Aprobación multi-nivel de gastos (no aplica al equipo actual)

---

## Cambios en este documento

- 2026-06-12 — Documento creado. EPIC B arranca en Fase B.1.
