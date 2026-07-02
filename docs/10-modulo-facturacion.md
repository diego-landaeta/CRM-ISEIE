# Módulo de Facturación — MultiCRM (documento completo)

> **Estado:** documento vivo de diseño e implementación.
> **Base:** *Especificación Funcional — Módulo de Facturación MultiCRM v1.0* (Manuel Casas, 2026-07-02).
> **Alcance:** aplica a **ambos CRMs** (ISEIH `360crm.tech/crm` e ISEIE `crm.iseie.com`), que comparten el mismo código de facturación (paridad).
> **Autores implementación:** Diego (backend) · Ángel (frontend).

Este documento consolida el spec funcional con **lo que ya está construido**, el **análisis de brechas por REQ**, la **arquitectura de datos**, el **plan para conectar proyectos ↔ sociedades** y el **roadmap por fases**. Convención: ✅ hecho · 🟡 parcial · ⛔ pendiente.

---

## 1. Resumen ejecutivo

El módulo `invoices` ya cubre buena parte del **motor común** del spec (numeración por serie, PDF configurable, rectificativas, snapshot fiscal, IVA/descuentos, plantillas condicionales). Lo que falta es sobre todo **el motor fiscal por producto/cliente**, **las proformas**, la **numeración a nivel de sociedad** (hoy es por proyecto), la **auto-facturación de todo pago**, el **panel por sociedad + ALL**, y los campos de **moneda/tipo de cambio** y **reserva Verifactu**.

| Área | Estado | Nota |
|---|---|---|
| Multi-emisor (sociedades emisoras) | ✅ | `invoice_issuers` con NIF, domicilio, IBAN, logo, serie propia |
| Serie correlativa | 🟡 | Existe, pero **keyed por proyecto**, no por sociedad (ver §4) |
| Tipos: factura / rectificativa | ✅ | `tipo` = normal/rectificativa, abono con importes negativos y serie `R+serie` |
| Tipos: proforma | ⛔ | No implementado |
| PDF configurable (editor Canva) | ✅ | Bloques A4 drag&drop, plantillas por empresa, encabezados editables |
| Plantillas condicionales por país | ✅ | España / extranjero / todos — selección automática |
| Motor fiscal (IVA por producto + cliente) | 🟡 | Sólo IVA 21/incluido/exento + condición país. Falta régimen por producto y reglas UE/Canarias |
| Coletillas parametrizadas | 🟡 | `leyenda_iva` libre por factura; falta tabla de regímenes→coletilla editable |
| Auto-factura al detectar/registrar pago | 🟡 | Modal manual + sync Stripe; falta asignación automática de nº en TODO pago |
| Panel por sociedad + ALL + export | 🟡 | Panel por proyecto con filtros; falta consolidado por sociedad y export Excel |
| Reembolsos → rectificativa automática | 🟡 | Rectificativa manual; falta disparo automático desde refund de Stripe |
| Moneda + tipo de cambio (LATAM) | ⛔ | No implementado |
| Conservación de PDF | ✅ | PDF guardado en disco por proyecto/año |
| Reserva Verifactu (`hash_encadenado`, `qr`) | ⛔ | Campos aún no creados |

---

## 2. Arquitectura de dos capas (spec §2) — mapeo al código actual

| Capa del spec | Dónde vive hoy |
|---|---|
| **A. Motor común** (numeración, tipos, IVA, PDF, coletillas, rectificativas, panel) | `backend/src/modules/invoices/*` (`invoices.model.js`, `invoices.service.js`, `invoices.controller.js`, `invoices.routes.js`) + `frontend/src/modules/invoices/*` |
| **B. Configuración por sociedad/proyecto** (datos fiscales, series, régimen fiscal por producto) | `invoice_issuers` (sociedades) · `invoice_sequences` (series) · `invoice_templates` (diseño) · **falta** `regimenes_fiscales` y `productos.regimen_fiscal_id` |

**Principio:** dar de alta un proyecto nuevo debe ser **sólo configuración** (REQ-PROY-01). Hoy se cumple para emisor/serie/plantilla; falta el régimen fiscal por producto.

---

## 3. Sociedades emisoras y conexión de proyectos (spec §3)

Tres sociedades = tres NIF = tres series independientes. Los proyectos se reparten **entre los dos CRMs**, por eso las sociedades son un concepto **transversal** (una misma SL emite en ambos CRMs).

| Sociedad emisora (NIF) | Proyectos | CRM donde vive el proyecto |
|---|---|---|
| **Lateral Thinking Solutions SL** | Academia IA | (a confirmar) |
| **Ictess Ingeniería e Innovación SL** | ICTESS · Veterinary AI | ISEIE |
| **CEDIA Investigación y Desarrollo SL** | Fono Aprende · Psiko Aprende · ISEIH · ISAEG · Psicólogo IA · Nutricionista IA · Tarot IA · Sexólogo IA | ISEIH (+ los IA) |

### Plan de conexión (a ejecutar)
1. **Dar de alta las 3 sociedades** como `invoice_issuers` en cada CRM donde tengan proyectos (datos fiscales reales + serie + logo). *Hecho parcial: la UI de empresas emisoras ya existe.*
2. **Asignar cada proyecto a su sociedad por defecto**: nuevo campo `projects.sociedad_emisora_id` (→ `invoice_issuers.id`) para que al facturar un proyecto se **preseleccione** su sociedad sin elegir a mano. (REQ-PROY-01)
3. **Unificar la serie a nivel sociedad** (ver §4) para que todos los proyectos de CEDIA compartan el correlativo `CEDIA-2026-NNNN`.

> ⚠️ **Decisión pendiente de Manuel:** ¿la sociedad se asigna por proyecto (fija) o se puede elegir por factura? Recomendación: **por proyecto** (default) con opción de cambiar por factura para casos excepcionales.

---

## 4. Numeración y series (spec §4) — **brecha principal**

**Estado hoy:** `invoice_sequences` tiene clave primaria **`(project_id, año, serie)`**. La serie vive en `invoice_issuers.serie` y al emitir se usa esa serie, pero el **contador es por proyecto**.

**Problema:** si CEDIA emite para 8 proyectos con serie `CEDIA`, hoy habría **8 contadores** distintos con la misma serie → números repetidos o incoherentes entre proyectos. El spec exige **una única serie correlativa por sociedad** (REQ-NUM-01/02).

**Solución propuesta:**
- Cambiar la clave de secuencia a **`(sociedad/serie, año)`** en vez de por proyecto. Concretamente: nueva tabla `invoice_series` `(id, issuer_id, tipo, prefijo, año, contador_actual)` o migrar `invoice_sequences` a keyear por `issuer_id + serie + año`.
- El nº se asigna **atómicamente** dentro de la transacción de creación (ya se hace vía `nextNumero()` con `SELECT … FOR UPDATE`/UPSERT), sólo cambia la clave.

| REQ | Estado | Detalle |
|---|---|---|
| REQ-NUM-01 serie por sociedad | 🟡→⛔ | Hoy por proyecto. **Migrar a por sociedad.** |
| REQ-NUM-02 sin huecos, no reutilizable | ✅ | El nº se asigna y no se borra; anular ≠ borrar (ver §9) |
| REQ-NUM-03 cierre 31/dic, reinicio 01/ene | ✅ | La secuencia incluye `año`; el contador reinicia por año |
| REQ-NUM-04 formato `[SERIE]-[AÑO]-[NNNN]` | 🟡 | Hoy `AÑO/NNNN`. **Cambiar a `SERIE-AÑO-NNNN`** (p. ej. `CEDIA-2026-0001`) — confirmar con Manuel |
| REQ-NUM-05 series propias proforma/rectificativa | 🟡 | Rectificativa ya usa `R+serie`. **Falta proforma** (`PRO-…`) |

---

## 5. Tipos de documento (spec §5)

| Tipo | Estado | Implementación |
|---|---|---|
| **Factura** | ✅ | `invoices.tipo='normal'`, correlativa, se genera al registrar/detectar pago o manualmente |
| **Rectificativa** | ✅ | `tipo='rectificativa'`, serie `R+serie`, `rectifica_id`/`rectifica_codigo` (referencia obligatoria), importes negativos |
| **Proforma** | ⛔ | **Pendiente.** Nuevo `tipo='proforma'`, serie `PRO-…`, **sin consumir** el correlativo de facturas; al confirmarse el pago se genera la factura real |

**REQ-DOC-01 (regla clave):** *todo pago genera número de factura automáticamente*. 🟡 Hoy la emisión es manual o vía modal al registrar pago; falta que **todo** pago detectado/registrado asigne número aunque no se pida el PDF.

---

## 6. Registro y detección de pagos (spec §6)

| REQ | Estado | Detalle |
|---|---|---|
| REQ-PAG-01 Stripe automático | 🟡 | Ya hay sync de `stripe_payments` (cron 5 min) + asociación a conversiones. **Falta** el paso "cobro confirmado → crea factura con nº". |
| REQ-PAG-02 transferencia manual | 🟡 | Se registra pago en la conversión; hay modal "generar factura". **Falta** asignación automática de nº igual que Stripe. |
| REQ-PAG-03 proforma bajo petición | ⛔ | Depende de implementar proformas (§5). |

**Acción:** un servicio `emitInvoiceForPayment(pago)` común que, ante cualquier pago (Stripe o transferencia), resuelva sociedad → serie → nº → régimen fiscal → coletilla → crea `invoice` (+ PDF opcional). Es el corazón de REQ-DOC-01/PAG-01/02.

---

## 7. Motor fiscal — IVA y coletillas (spec §7) — **el núcleo pendiente**

Hoy el IVA es una decisión simple en el formulario (21% / incluido / exento) + plantilla por país. El spec pide un **motor** que combine **régimen del producto** × **ubicación/tipo de cliente**.

### 7.1 Régimen por producto (REQ-FIS-01) — ⛔
- Nueva tabla **`regimenes_fiscales`** `(id, nombre, aplica_iva bool, tipo_iva, coletilla)`.
- Nuevo campo **`products.regimen_fiscal_id`** (herramientas digitales → 21%; formación exenta → sin IVA).

### 7.2 Reglas por ubicación/cliente (REQ-FIS-02) — ⛔
Motor que resuelve el IVA final combinando régimen + origen del pago:

| Origen | IVA | Regla |
|---|---|---|
| España — con IVA | 21% incluido | producto no exento |
| España — exento | 0% | producto/formación exenta |
| Canarias | 0% (IGIC) | asimilada a exportación |
| UE B2B (VIES válido) | 0% | inversión del sujeto pasivo — requiere `nif_iva_vies` |
| UE B2C | según normativa | servicios digitales (a confirmar asesoría) |
| Fuera UE | 0% | no sujeta / exportación de servicios |

Requiere en el cliente: `pais`, `tipo (particular/empresa)`, `nif_iva_vies`. Los leads ya tienen país y NIF fiscal; **falta** `tipo` y `nif_iva_vies` + (opcional) validación VIES.

### 7.3 Coletillas automáticas (REQ-FIS-03) — 🟡
- Hoy `invoices.leyenda_iva` es texto libre por factura (se imprime en el PDF).
- **Falta** que la coletilla salga **de la tabla `regimenes_fiscales`** (editable, no hardcodeada) según el caso resuelto por el motor. Textos borrador en el spec §7.3 — **a validar con asesoría**.

---

## 8. Datos obligatorios (spec §8)

Capturados hoy en `invoices`: serie/nº, `fecha_emision`, emisor completo (snapshot `issuer_*`), descripción (items), cliente (nombre/nif/dirección/país/…), `base_imponible`, `iva_pct`/`iva_importe`, `total`, `leyenda_iva`. 

**Falta:** `fecha_operacion` (devengo, distinta de expedición) y `cliente.nif_iva_vies`. ✅ el resto está.

---

## 9. Panel de facturas (spec §9)

- ✅ Panel por proyecto (`InvoicesPage`) con lista, KPIs (facturado/cobrado/IVA), filtros (estado, fechas, búsqueda) y "Ventas sin factura".
- 🟡 **REQ-PAN-01/03:** falta la vista **por sociedad** y la **global "ALL"** consolidando las tres SL (columnas: Nº, Fecha, Cliente, Proyecto, Servicio, Base, IVA, Total, Estado).
- 🟡 **Estados:** hoy `emitida/enviada/pagada/cancelada`; el spec pide `pagada/rectificada/anulada/proforma`. **Alinear** el enum.
- ⛔ **REQ-PAN-04:** export a Excel/PDF para la asesoría.

---

## 10. Reembolsos, anulaciones, moneda, conservación (spec §10-11)

| REQ | Estado | Detalle |
|---|---|---|
| REQ-REE-01 refund Stripe → rectificativa | 🟡 | Rectificativa manual lista; **falta** disparo automático desde `charge.refunded` |
| REQ-REE-02 anulación sin borrar | ✅ | Cancelar marca estado, no borra nº (falta renombrar a "anulada") |
| REQ-MON-01 moneda + tipo de cambio | ⛔ | **Nuevos campos** `moneda`, `tipo_cambio`, importe en EUR para cobros LATAM (MXN/CLP/PEN) |
| REQ-CON-01 conservación PDF | ✅ | PDF persistido por proyecto/año; añadir política de retención 4/6 años |

---

## 11. Modelo de datos — actual vs objetivo

| Tabla spec | Tabla actual | Acción |
|---|---|---|
| `sociedades` | `invoice_issuers` | ✅ (renombra conceptualmente). Añadir link desde `projects` |
| `proyectos` | `projects` | ➕ `sociedad_emisora_id` |
| `series` | `invoice_sequences` | 🔧 **re-key por sociedad** + `tipo` (factura/proforma/rectificativa) |
| `regimenes_fiscales` | — | ➕ **crear** `(nombre, aplica_iva, tipo_iva, coletilla)` |
| `productos` | `products` | ➕ `regimen_fiscal_id` |
| `clientes` | `leads` | ➕ `tipo (particular/empresa)`, `nif_iva_vies` (país/NIF ya existen) |
| `facturas` | `invoices` (55 cols) | ➕ `fecha_operacion`, `moneda`, `tipo_cambio`, `pago_id`, `hash_encadenado`, `qr`; alinear `estado`; añadir `proforma` |
| `pagos` | `stripe_payments` + `conversion_payments` | 🔧 unificar concepto `pago(origen, importe, moneda, fecha, ref_externa)` |

`invoices` **ya incluye** el snapshot del emisor, `tipo`, `rectifica_id`, descuentos y `template_id` — buena base para no reconstruir nada.

---

## 12. Análisis de brechas por REQ

| REQ | Estado | Trabajo pendiente |
|---|---|---|
| REQ-PROY-01 | 🟡 | `projects.sociedad_emisora_id` + preselección |
| REQ-NUM-01 | ⛔ | Serie por **sociedad** (hoy por proyecto) |
| REQ-NUM-02 | ✅ | — |
| REQ-NUM-03 | ✅ | — |
| REQ-NUM-04 | 🟡 | Formato `SERIE-AÑO-NNNN` (confirmar) |
| REQ-NUM-05 | 🟡 | Serie de **proforma** |
| REQ-DOC-01 | 🟡 | Auto-nº en todo pago |
| REQ-PAG-01/02 | 🟡 | Servicio común `emitInvoiceForPayment` |
| REQ-PAG-03 | ⛔ | Proformas |
| REQ-FIS-01 | ⛔ | `regimenes_fiscales` + `products.regimen_fiscal_id` |
| REQ-FIS-02 | ⛔ | Motor de reglas ubicación/cliente (Canarias, UE B2B/B2C, fuera UE) |
| REQ-FIS-03 | 🟡 | Coletilla desde tabla editable |
| REQ-DAT-01 | 🟡 | `fecha_operacion`, `nif_iva_vies` |
| REQ-PAN-01/02 | ✅/🟡 | Panel por sociedad |
| REQ-PAN-03 | ⛔ | Vista ALL consolidada |
| REQ-PAN-04 | ⛔ | Export Excel/PDF |
| REQ-REE-01 | 🟡 | Refund Stripe → rectificativa auto |
| REQ-REE-02 | ✅ | Renombrar estado "anulada" |
| REQ-MON-01 | ⛔ | Moneda + tipo de cambio |
| REQ-CON-01 | ✅ | Política de retención |
| Verifactu-ready | ⛔ | Columnas `hash_encadenado`, `qr` (vacías) |

---

## 13. Roadmap propuesto (por fases)

- **Fase A — Sociedades y numeración correcta** *(base fiscal)*
  Alta de las 3 SL, `projects.sociedad_emisora_id`, re-key de series **por sociedad**, formato `SERIE-AÑO-NNNN`, estados alineados, columnas Verifactu-ready.
- **Fase B — Motor fiscal**
  `regimenes_fiscales` + `products.regimen_fiscal_id` + motor de reglas (España/Canarias/UE B2B-B2C/fuera UE) + coletillas parametrizadas + `nif_iva_vies` y `tipo` de cliente.
- **Fase C — Auto-facturación de pagos**
  `emitInvoiceForPayment` común (Stripe + transferencia), auto-nº en todo pago (REQ-DOC-01), refund Stripe → rectificativa (REQ-REE-01).
- **Fase D — Proformas** (serie propia, conversión a factura al pagar).
- **Fase E — Panel por sociedad + ALL + export** (Excel/PDF) y estados `pagada/rectificada/anulada/proforma`.
- **Fase F — Moneda/tipo de cambio** (cobros LATAM en EUR + tasa de la fecha de devengo).
- **(Futuro) Verifactu / Ley Antifraude** — sólo cuando se active; la base ya queda preparada.

Lo **ya construido** (multi-emisor, editor Canva, plantillas condicionales, rectificativas, snapshot fiscal, IVA/descuentos, unificación de facturación, numeración por empresa) es la base sobre la que se montan estas fases — **no hay que reconstruir**, sólo extender.

---

## 13.bis Decisiones confirmadas (2026-07-02)

- **Sociedades:** se crean desde **Empresas emisoras** (ya existe). La **serie la escribe/edita el admin o superadmin** (ya editable). Datos fiscales reales los carga el equipo.
- **Formato de numeración:** **configurable por el superadmin** (no fijo en código). El formato exacto (`SERIE-AÑO-NNNN` vs `AÑO/NNNN`) se decide al revisar las facturas reales.
- **Auto-facturación de pagos (prioridad):** un cobro de **Stripe** genera factura + correlativo automáticamente; un pago por **transferencia**, al registrarse, también recibe su correlativo. (REQ-PAG-01/02, Fase C).
- **Resumen descargable por mes/período** + **conteo de IVA aproximado** en el panel (Fase E). *IVA aprox. ya visible en la pantalla de Ventas.*
- **Comisiones (nuevo módulo):** modelo **mixto** — cada persona puede tener **salario fijo** y/o **comisión** (por **venta individual** con % propio, o por **equipo** según su participación). Se **suman**. (Fase H).
- **Ventas (simplificar):** mostrar nº de conversiones (hecho) + **eliminar conversión** (con salvaguardas: no borrar si tiene factura/pagos asociados).
- **"Cuadro de períodos al pagar":** en pausa hasta que Manuel lo aclare.

### 13.ter Requisitos nuevos (2026-07-02, 2ª tanda)

- **REQ-GATE-01 — Bloqueo de emisión sin datos fiscales:** el CRM **no debe permitir crear/emitir facturas** hasta que la **sociedad emisora** tenga sus datos fiscales completos. Aviso claro + enlace al panel. El bloqueo aplica **sólo a la emisión de facturas**; el resto del CRM sigue funcionando (leads, ventas, etc.) — *no rompe el flujo actual*.
- **REQ-GATE-02 — Validación exacta para España:** los datos fiscales del emisor deben validarse **para España**: razón social, **NIF/CIF válido** (DNI/NIE/CIF con dígito de control), dirección, ciudad, código postal y país. Sólo con todo correcto se habilita facturar.
- **REQ-PANEL-01 — Panel de sociedades:** un panel (dentro de *Configuración de facturación → Empresas emisoras*) donde el admin/superadmin **completa y ve el estado** de cada sociedad (✓ completa / ⚠ faltan campos), y desde donde se resuelve el bloqueo.
- **REQ-VISTA-01 — Vistas por sociedad:** las **vistas de proyectos se organizan por sociedad**. Cada proyecto pertenece a una sociedad (`projects.sociedad_emisora_id`) y el panel de facturación puede verse **por sociedad** y en **"ALL"** (consolidado). Depende de Fase A.
- **Mapeo confirmado:** **Academia IA → Lateral Thinking Solutions SL.**

## 15. Cómo trabajaremos en ambos CRMs (método de trabajo)

El módulo de facturación es **idéntico** en los dos CRMs (regla de **paridad absoluta**): ISEIH (`360crm.tech/crm`) e ISEIE (`crm.iseie.com`) comparten el mismo código de `invoices` y del motor fiscal. Toda mejora se hace **en los dos**.

**Reglas de trabajo:**
1. **Paridad de código:** los archivos del módulo `invoices` (backend `backend/src/modules/invoices/*` y frontend `frontend/src/modules/invoices/*`) se mantienen espejo entre ambos repos. Se editan en uno y se replican al otro. **Excepción:** archivos de navegación/rutas (Sidebar, App.jsx) y de branding **NO** se copian enteros — se hacen ediciones puntuales, porque difieren (ISEIE usa base `/accounting`, ISEIH `/finanzas`; sidebars distintos).
2. **Migraciones de DB:** cada cambio de esquema se aplica a **ambas** bases (`crm_prod_db` en ISEIH · `crm_iseie` en ISEIE). Numeración de migraciones independiente por repo.
3. **Sociedades transversales:** una misma sociedad (ej. **CEDIA**) emite en **ambos CRMs**, porque sus proyectos viven repartidos. Las sociedades se dan de alta como *empresas emisoras* en **cada CRM donde tenga proyectos**. Si más adelante se centraliza, se evaluará una tabla compartida.
4. **Reparto de proyectos → sociedad → CRM:**

   | Sociedad | Proyectos | CRM |
   |---|---|---|
   | Lateral Thinking Solutions SL | Academia IA | (confirmar) |
   | Ictess Ingeniería e Innovación SL | ICTESS · Veterinary AI | ISEIE |
   | CEDIA Investigación y Desarrollo SL | Fono Aprende · Psiko Aprende · ISEIH · ISAEG · Psicólogo IA · Nutricionista IA · Tarot IA · Sexólogo IA | ISEIH (+ IA) |

5. **Deploy:** cada cambio → build + deploy en los dos servidores (VPS ISEIH `187.124.128.126` vía SSH · VPS ISEIE `72.60.90.135` vía paramiko) + commit/push a `main` en ambos repos.
6. **Orden de fases (aplican a ambos):** A (sociedades + numeración + **gating fiscal**) → C (auto-factura pagos) → E (resumen/export) → H (comisiones) → B (motor fiscal). Cada fase se cierra en los dos CRMs antes de pasar a la siguiente.

## 14. Pendiente de Manuel / asesoría (antes de producción)

- Validar **textos de coletillas** (§7.3).
- Confirmar **formato de numeración** definitivo (REQ-NUM-04).
- Confirmar el **tratamiento fiscal exacto de cada producto** (exento vs 21%).
- Confirmar **régimen B2C UE** para servicios digitales.
- Confirmar si la **sociedad** es fija por proyecto o elegible por factura.
