# Modulo Facturación — Diseño aprobado

> Decisiones tomadas con Diego el 2026-06-17. Este documento es la referencia
> al implementar. Aplica IDÉNTICO en ambos CRMs (ISEIH y ISEIE).

## Tipo de factura

**Factura española PDF interna**, generada por el CRM. NO usar Stripe Invoices.
- Numeración correlativa por año: `2026/0001`, `2026/0002`, ...
- Datos fiscales completos del cliente
- Validez para Hacienda

## Cuándo se emite

- **Al crear la conversión** → aparece el botón **"Ver factura"** en la conversión.
  Si los datos fiscales del cliente están completos, abre el PDF directamente.
  Si faltan datos → abre un modal pidiendo solo los obligatorios faltantes.

- **Al registrar el primer pago** → aparece un modal de confirmación:
  - "¿Enviar factura por email a `<email>`?" [Enviar] [No por ahora]
  - Evita disparar el envío por error.

## IVA

- **Default España**: 21%
- **Resto del mundo**: 0%
- Detección automática por `pais_fiscal` del cliente.
- Override manual por factura: dropdown `lleva IVA / no lleva` + checkbox `incluido / no incluido`.
- Si el producto está exento → leyenda automática "Operación exenta art. 20º LIVA".

## Datos fiscales del cliente

Modal "Datos fiscales" (al pulsar "Ver factura" si faltan datos):

| Campo | Default | Required | Mostrar en modal si vacío | En PDF si vacío |
|---|---|---|---|---|
| Nombre | `lead.nombre` | sí | siempre | n/a |
| NIF/DNI/CIF | `lead.identificacion_fiscal` | **sí** | siempre | n/a |
| Dirección fiscal | `lead.direccion_fiscal` | **sí** | siempre | n/a |
| Ciudad | `lead.ciudad_fiscal` (nueva) | **sí** | siempre | n/a |
| Código postal | `lead.codigo_postal_fiscal` (nueva) | **sí** | siempre | n/a |
| País | `lead.pais_fiscal` (nueva, default España) | **sí** | siempre | n/a |
| Email | `lead.email` | no | **NO**, solo si lead lo tiene | **NO**, solo si existe |
| Teléfono | `lead.telefono` | no | **NO**, solo si lead lo tiene | **NO**, solo si existe |

**Regla clave**: al guardar el modal → actualiza el lead con los datos fiscales.
Próxima factura ya no pide nada (auto-skip).

## Schema

### Migración 090 (ISEIH) / 088 (ISEIE)

```sql
-- 1) Columnas fiscales en leads
ALTER TABLE leads
  ADD COLUMN ciudad_fiscal          VARCHAR(120),
  ADD COLUMN codigo_postal_fiscal   VARCHAR(20),
  ADD COLUMN pais_fiscal            VARCHAR(80) DEFAULT 'España';

-- 2) Tabla invoices
CREATE TABLE invoices (
  id              SERIAL PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversion_id  INTEGER REFERENCES conversions(id) ON DELETE SET NULL,
  lead_id         INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  serie           VARCHAR(10) NOT NULL DEFAULT 'A',
  ano             INTEGER NOT NULL,
  numero          INTEGER NOT NULL,
  codigo          VARCHAR(30) NOT NULL,                -- '2026/0001'
  fecha_emision   DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_pago      DATE,
  -- Snapshot cliente (no FK soft, se congelan los datos al emitir)
  cliente_nombre  VARCHAR(200) NOT NULL,
  cliente_nif     VARCHAR(50) NOT NULL,
  cliente_direccion TEXT NOT NULL,
  cliente_ciudad  VARCHAR(120) NOT NULL,
  cliente_cp      VARCHAR(20) NOT NULL,
  cliente_pais    VARCHAR(80) NOT NULL,
  cliente_email   VARCHAR(255),
  cliente_telefono VARCHAR(50),
  -- Items (1 linea = 1 producto del conversion)
  items           JSONB NOT NULL,                       -- [{descripcion, cantidad, precio_unitario, subtotal}]
  -- Importes
  base_imponible  NUMERIC(10,2) NOT NULL,
  iva_pct         NUMERIC(5,2)  NOT NULL DEFAULT 21,
  iva_importe     NUMERIC(10,2) NOT NULL DEFAULT 0,
  iva_incluido    BOOLEAN       NOT NULL DEFAULT false,
  total           NUMERIC(10,2) NOT NULL,
  -- Estado
  estado          VARCHAR(20)   NOT NULL DEFAULT 'emitida' CHECK (estado IN ('emitida','enviada','pagada','cancelada')),
  notas           TEXT,
  leyenda_iva     TEXT,                                  -- 'Operación exenta art. 20º LIVA' si aplica
  -- PDF
  pdf_path        VARCHAR(500),
  -- Envío
  sent_at         TIMESTAMPTZ,
  sent_to_email   VARCHAR(255),
  -- Auditoria
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_invoice_codigo UNIQUE (project_id, codigo),
  CONSTRAINT uq_invoice_year_serie_numero UNIQUE (project_id, ano, serie, numero)
);

CREATE INDEX idx_invoice_project_estado ON invoices (project_id, estado);
CREATE INDEX idx_invoice_conversion ON invoices (conversion_id);
CREATE INDEX idx_invoice_lead ON invoices (lead_id);

-- 3) Secuencia atómica por proyecto/año/serie
CREATE TABLE invoice_sequences (
  project_id INTEGER NOT NULL,
  ano        INTEGER NOT NULL,
  serie      VARCHAR(10) NOT NULL DEFAULT 'A',
  ultimo_numero INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, ano, serie),
  CONSTRAINT fk_iseq_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

### Numeración atómica

```sql
-- En transacción al crear factura:
BEGIN;
INSERT INTO invoice_sequences (project_id, ano, serie, ultimo_numero)
  VALUES ($1, $2, $3, 1)
  ON CONFLICT (project_id, ano, serie) DO UPDATE
    SET ultimo_numero = invoice_sequences.ultimo_numero + 1
  RETURNING ultimo_numero;
-- usa el numero retornado para construir codigo: '2026/0001'
INSERT INTO invoices (...) VALUES (...);
COMMIT;
```

## Endpoints

| Método | Path | Descripción |
|---|---|---|
| `POST` | `/api/invoices` | Crear factura (body: conversionId, datos fiscales completos, items, iva config) |
| `GET` | `/api/invoices?projectId=X` | Listado con filtros |
| `GET` | `/api/invoices/:id` | Detalle |
| `GET` | `/api/invoices/:id/pdf` | Stream PDF (genera si no existe) |
| `POST` | `/api/invoices/:id/send` | Enviar por Brevo al `cliente_email` |
| `PATCH` | `/api/invoices/:id` | Edición (limitada — solo si `estado='emitida'`) |
| `POST` | `/api/invoices/:id/marcar-pagada` | Marca pagada (manual o por trigger Stripe) |

## PDF — librería

`pdfkit` (puro Node, sin Chromium). Plantilla con:
- Cabecera: logo proyecto, datos fiscales emisor
- Cliente: nombre, NIF, dirección
- Tabla items: descripción, cantidad, precio, subtotal
- Totales: base, IVA, total
- Leyenda IVA si aplica
- Pie con número de factura y código QR (opcional)

## Trigger UI — botones

### En página de conversión

```
[Ver factura]  → Si datos fiscales completos → abre PDF
                 Si faltan → modal "Datos fiscales"
                              → al guardar → genera factura → abre PDF
```

### Al registrar pago (en módulo conversions)

Después de `POST /conversions/:id/payments`:
- Si la conversión tiene factura `estado='emitida'` y aún no fue enviada:
  - Frontend muestra modal: "¿Enviar factura `2026/0001` por email a `cliente@ejemplo.com`?"
  - Botones: [Enviar] → `POST /invoices/:id/send` → estado pasa a `enviada`
            [No por ahora] → modal cierra, no envía
- Si el pago completa el total → marca factura como `pagada` automáticamente

## Reglas de negocio críticas

1. **Numeración atómica**: usar SELECT FOR UPDATE o INSERT ... ON CONFLICT atomicamente.
2. **No editar factura emitida** después de enviarla legalmente. Si hay que corregir → emitir factura rectificativa (futuro).
3. **Snapshot cliente**: los datos del cliente se congelan en la factura. Si el lead cambia su dirección después, la factura emitida NO se modifica.
4. **PDF persistido**: guardar PDF en disco (`/var/lib/crm-invoices/<project_id>/<ano>/<codigo>.pdf`) para evitar regeneración constante.
5. **Email Brevo**: usar From email del proyecto activo. Adjunto: PDF. Subject: "Factura {{codigo}} - {{nombre_emisor}}".

## Pendiente futuro (no en esta tanda)

- Factura rectificativa (devoluciones)
- Verifactu (próxima ley española de facturación)
- Múltiples series por proyecto
- Plantilla PDF customizable por proyecto
- Recibos parciales separados de la factura

---

**Estado**: aprobado el 2026-06-17. Listo para implementación.
