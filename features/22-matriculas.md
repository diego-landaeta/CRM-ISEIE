# Matriculas post-conversion

**Jira:** CRM-176
**Estado:** 📝 Backlog
**Tipo:** Epic

## Contexto

El flujo actual termina en "conversion" (venta cerrada). Pero para los centros de formacion (Psiko, ISEIH), cuando el cliente paga debe hacer la **matricula formal**: subir DNI, titulo, firmar, y un admin valida. Este flujo es admin-intensivo y hoy se hace fuera del CRM.

Basado en los forms reales de [psikoaprende.com/admision](https://psikoaprende.com/admision) y [iseih.com/admision](https://iseih.com/admision).

## Regla

**Solo un lead con `status=convertido` puede iniciar una matricula.** No es un form publico de captura, es post-venta.

## Estados de la matricula

1. `pendiente_documentos` (arranque: conversion creada)
2. `en_revision` (cliente subio todos los docs)
3. `validada` (admin aprobo)
4. `rechazada` (falta algo, motivo requerido)
5. `matriculado` (proceso completado, cliente accede al campus virtual)

## Datos que recoge

- Programa (auto-rellenado del producto contratado)
- Datos personales (auto-rellenados del lead: nombre, email, telefono)
- Direccion: calle, ciudad, provincia, CP, pais
- DNI frontal * (PDF/JPG/PNG/WEBP max 5MB)
- DNI trasero * (PDF/JPG/PNG/WEBP max 5MB)
- Titulo universitario (opcional)
- Firma digital (canvas → PNG → R2)
- Referidos (opcional): alumno / profesor / amigo con campo texto condicional

## Modelo

```sql
CREATE TABLE enrollments (
  id SERIAL PRIMARY KEY,
  lead_id INT NOT NULL REFERENCES leads(id),
  conversion_id INT NOT NULL REFERENCES conversions(id) UNIQUE,
  producto_id INT REFERENCES products(id),
  estado VARCHAR(30) NOT NULL DEFAULT 'pendiente_documentos',
  datos JSONB,  -- direccion, referidos, etc
  motivo_rechazo TEXT,
  validada_por INT REFERENCES users(id),
  validada_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE enrollment_attachments (
  id SERIAL PRIMARY KEY,
  enrollment_id INT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  tipo VARCHAR(30) CHECK (tipo IN ('dni_frontal','dni_trasero','titulo','firma')),
  r2_key VARCHAR(500) NOT NULL,
  filename VARCHAR(300),
  content_type VARCHAR(100),
  size_bytes INT,
  uploaded_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Endpoints

| Metodo | Path | Descripcion |
|---|---|---|
| POST | `/api/enrollments` | Crea matricula (solo admin) |
| GET | `/api/enrollments?projectId=X&estado=Y` | Lista |
| GET | `/api/enrollments/:id` | Detalle con attachments |
| POST | `/api/enrollments/:id/attachments` | Upload documento |
| GET | `/api/enrollments/:id/attachments/:attId` | Descargar (presigned URL) |
| PATCH | `/api/enrollments/:id/state` | Cambiar estado (validar/rechazar) |

## Flujo cliente (via link con token)

1. Admin crea matricula desde LeadDetail de un lead convertido
2. CRM envia link con token unico al cliente via Brevo
3. Cliente abre el link, ve su progreso, sube docs, firma
4. Estado pasa a `en_revision`
5. Admin valida/rechaza desde el CRM
6. Si validada: email de bienvenida al campus virtual (plantilla Brevo)

## UI admin

- Pagina `/enrollments` con filtros por estado + proyecto activo
- Detalle con preview de documentos + canvas de la firma
- Botones "Validar" / "Rechazar con motivo"

## UI cliente (publica con token)

- Wizard tipo los forms actuales de admision
- Progreso visual: paso 2 de 6
- Canvas para firma con boton borrar

## Dependencias

- Prerequisito: conversion creada con `status=convertido`
- Brevo para notificaciones (CRM-185 tampoco es hard-dep, usa templates del mismo modulo)
- Storage: localStorage.service o R2

## AC

- [ ] Admin crea matricula solo si la conversion existe
- [ ] Cliente sube los 3 documentos y firma
- [ ] Admin valida → email de bienvenida al campus
- [ ] Rechazo pide motivo obligatorio
- [ ] Documentos accesibles via presigned URL con expiracion 15min
