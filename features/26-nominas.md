# Nominas — fijo + horas + comisiones

**Jira:** CRM-171 + CRM-173 + CRM-174
**Estado:** 📝 Backlog
**Tipo:** Epic grande

## Contexto

Hoy cada gestor cobra por comisiones (CRM-129). Pero en la realidad del equipo hay otras modalidades: sueldo fijo mensual, pago por hora, combinaciones. El modulo nominas extiende comisiones a un gestor completo de compensaciones.

## Esquemas de pago permitidos

Todas las combinaciones son validas (usuario lo confirmo), pero algunas son mas comunes:

| Esquema | Comentario |
|---|---|
| solo_fijo | Salario fijo mensual |
| solo_horas | Pago por hora trabajada |
| solo_comisiones | Solo % de ventas (ya existe en CRM-129) |
| fijo + comisiones | **Comun** |
| horas + comisiones | **Comun** |
| fijo + horas | Permitido pero poco comun (mostrar warning UI) |
| fijo + horas + comisiones | Permitido pero muy raro |

## Modelo

```sql
CREATE TABLE payroll_plans (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  tipo VARCHAR(50) NOT NULL, -- solo_fijo | solo_horas | solo_comisiones | fijo_comisiones | horas_comisiones | fijo_horas | fijo_horas_comisiones
  salario_fijo_mensual DECIMAL(12,2),
  tarifa_hora DECIMAL(10,2),
  moneda VARCHAR(10) DEFAULT 'EUR',
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE,
  active BOOLEAN DEFAULT true
);

CREATE TABLE work_hours (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  project_id INT REFERENCES projects(id),
  fecha DATE NOT NULL,
  horas DECIMAL(5,2) NOT NULL,
  descripcion TEXT,
  registrado_por INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payroll_periods (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  fijo_importe DECIMAL(12,2) DEFAULT 0,
  horas_total DECIMAL(7,2) DEFAULT 0,
  horas_importe DECIMAL(12,2) DEFAULT 0,
  comisiones_importe DECIMAL(12,2) DEFAULT 0,
  ajustes_importe DECIMAL(12,2) DEFAULT 0, -- bonos/anticipos/descuentos
  total DECIMAL(12,2) GENERATED ALWAYS AS (fijo_importe + horas_importe + comisiones_importe + ajustes_importe) STORED,
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada','cancelada')),
  paid_at DATE,
  UNIQUE (user_id, year, month)
);

-- CRM-173: Ajustes puntuales
CREATE TABLE payroll_adjustments (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  periodo_id INT REFERENCES payroll_periods(id),
  project_id INT REFERENCES projects(id),
  tipo VARCHAR(20) CHECK (tipo IN ('bono','anticipo','descuento','extra')),
  concepto VARCHAR(300) NOT NULL,
  importe DECIMAL(12,2) NOT NULL, -- + suma, - resta
  fecha DATE NOT NULL,
  registrado_por INT REFERENCES users(id),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CRM-174: Comprobantes adjuntos
CREATE TABLE payroll_attachments (
  id SERIAL PRIMARY KEY,
  parent_type VARCHAR(20) CHECK (parent_type IN ('commission','adjustment','period')),
  parent_id INT NOT NULL,
  r2_key VARCHAR(500),
  filename VARCHAR(300),
  content_type VARCHAR(100),
  size_bytes INT,
  uploaded_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Endpoints

### Plans
- `GET/POST/PATCH/DELETE /api/payroll/plans` (superadmin)

### Horas
- `GET /api/payroll/hours?userId=X&from=Y&to=Z`
- `POST /api/payroll/hours` (gestor registra sus horas)
- `PATCH /api/payroll/hours/:id` (admin corrige)

### Periodos (cierre mensual)
- `GET /api/payroll/periods?userId=X&year=Y`
- `POST /api/payroll/periods/close-month` (admin: genera period_id con todos los totales del mes)
- `PATCH /api/payroll/periods/:id/pay` (admin marca como pagada)

### Ajustes
- `GET/POST/PATCH/DELETE /api/payroll/adjustments`

### Vistas
- `GET /api/payroll/me` (gestor ve su propio desglose del mes)
- `GET /api/payroll` (admin: tabla todos los gestores)

### Attachments
- `POST /api/payroll/attachments` con parent_type + parent_id
- `GET /api/payroll/attachments/:id/url` (presigned URL)
- `DELETE /api/payroll/attachments/:id`

## UI

**Pagina `/payroll` (admin):**
- Tabla por usuario con su plan + totales del mes actual
- Boton "Cerrar mes" → crea period_id + bloquea edicion
- Boton "Añadir ajuste" por fila
- Boton "Subir comprobante" tras pagar
- Click en una fila → detalle del mes (desglose horas + comisiones + ajustes)

**Pagina `/payroll/me` (gestor):**
- Desglose del mes en curso
- Historial de meses anteriores
- Registrar horas (si su plan incluye horas)

**Pagina `/payroll/hours` (todos):**
- Calendario visual para registrar horas por dia
- Admin aprueba

## UI warning para fijo+horas

Al seleccionar "fijo + horas" sin comisiones en el plan:
```
⚠ Esta combinacion es poco comun. Normalmente si hay salario fijo no se paga por hora,
o viceversa. Confirma que es lo que deseas.
```

## Integracion con CRM-129 (commissions)

El modulo reusa la tabla `commissions` existente. Al cerrar un mes:
- `commissions.estado = 'pendiente'` con `created_at` en el mes → entra al period
- Se genera `payroll_periods` con `comisiones_importe` = suma
- `commissions.estado` pasa a `pagado` si el periodo se marca pagado

## Dependencias

- CRM-129 ya implementado (base)
- Respeta CRM-178 (modulo `payroll` togglable por proyecto)
- Reusa localStorage.service para attachments

## AC

- [ ] Admin define plan de cada gestor
- [ ] Gestor registra horas
- [ ] Cierre de mes genera period con totales correctos
- [ ] Ajustes suman/restan al total
- [ ] Comprobante adjunto accesible para admin + gestor dueño
- [ ] fijo+horas muestra warning pero permite guardar
