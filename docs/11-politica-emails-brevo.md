# Política de emails (Brevo) — ambos CRMs

**Fecha**: 2026-06-12
**Aplica a**: CRM ISEIE y CRM ISEIH
**Motivo**: Brevo free = 300 emails/día. ISEIE solo recibe ~86 leads/día (picos de 160). Si cada flujo manda email automático, se quema el cupo en 1 día.

---

## 1. Decisiones tomadas

### 1.1. Email de **documento generado** → manual + preview obligatorio
- **Aplica a**: PDFs generados por el CRM (matrículas, certificados, recibos, dossiers…).
- **Antes**: el sistema enviaba el PDF automáticamente al cliente apenas se generaba (`documents.email.js`).
- **Ahora**:
  1. El PDF se genera y queda en `/documentos`
  2. **NO se envía automáticamente**
  3. El gestor/admin abre el documento, ve un **botón "Enviar al cliente"**
  4. Al pulsarlo se abre un **preview** con asunto, cuerpo HTML, lista de destinatarios y adjunto
  5. El gestor puede editar el asunto/cuerpo si necesita personalizar
  6. Pulsa **"Confirmar envío"** → ahí sí Brevo manda
  7. Queda registrado en `lead_emails` con `brevo_msg_id` para tracking

**Implementación**:
- Backend: `documents.email.js` deja de llamarse desde el generador. El endpoint `POST /documents/:id/resend-email` se renombra a `POST /documents/:id/send` y empieza a aceptar `{subject, htmlContent}` opcional para sobreescribir.
- Nuevo endpoint: `GET /documents/:id/email-preview` → devuelve `{to, defaultSubject, defaultBody, attachmentName}`.
- Frontend: en `/documentos/:id` botón verde "Enviar al cliente" → abre dialog `DocumentEmailPreviewDialog` → review → envía.

**Beneficios**:
- Cero emails automáticos no deseados
- El gestor ve qué se envía antes de enviarlo
- Cumple con auto_email_documents=false como default
- Si Brevo está caído, el documento se sigue generando — no bloquea el flujo

### 1.2. Email de **lead asignado al gestor** → mover a campanita + digest
- **Aplica a**: notificación al gestor cuando entra un lead por webhook y se le asigna.
- **Antes**: cada lead = 1 email a la gestora correspondiente. ISEIE quemaba 80–160 emails/día solo por esto.
- **Ahora**: 3 capas:
  1. **Campanita in-app SIEMPRE** (canal principal, sin coste, igual que recordatorios) — la gestora la ve al instante si está conectada
  2. **Toast/badge en el sidebar** si está dentro del CRM
  3. **Email digest** opcional: 1 email cada **30 min** por gestora con todos los leads acumulados en ese intervalo (en vez de 1 por lead). Si en 30 min entran 20 leads → 1 email con 20. Si entra 1 → email con 1.
     - Configurable: `EMAIL_DIGEST_INTERVAL_MIN=30` en `.env`
     - Si se pone a `0` → desactiva email, solo campanita

**Estimación de ahorro con digest 30 min en ISEIE**:
- Antes: 86 leads × 1 email = **86 emails/día**
- Después: ~48 ventanas de 30min con actividad × N gestoras (~3–5 gestoras) = **~5–15 emails/día**
- Ahorro: 80–95%

---

## 2. Catálogo de flujos que SÍ deben ir por email (los necesarios)

| Flujo | Cuándo dispara | Volumen estimado/día | Mantener email |
|---|---|---|---|
| Welcome al nuevo user (set-password) | Superadmin crea user | ~0–2/día | ✅ Sí, es 1 toque y el user lo necesita para entrar |
| Recordatorios vencidos | Reminder scheduler | ~5–20/día | ⚠ Campanita ya cumple. Email solo si Brevo configurado, best-effort (no bloquea). |
| Documentos al cliente | Manual con preview (1.1) | ~10–30/día (matrículas, certs) | ✅ Sí, pero solo manual con preview |
| Manual del gestor al lead | Gestor escribe email desde lead | ~5–15/día | ✅ Sí, lo escribe el humano |
| Secuencias drip | emailSequenceScheduler | depende de campañas activas | ✅ Sí (es marketing programado, ya tiene caps) |
| RFC: PM/CEO notification | Nueva solicitud, enviada al CEO | ~0–3/día | ✅ Sí, son operativos |
| Google Ads token expirando | Token va a caducar | ~0–1/mes | ✅ Sí, crítico para el admin |

**Total estimado/día con esta política**: ~25–60 emails/día → cabe holgadamente en Brevo free 300/día.

---

## 3. Tareas técnicas derivadas (a meter en Sprint 1)

### EPIC H — Política de emails (1.5 días, paralelo al resto)

H.1. **Document email manual + preview** (ambos CRMs)
- Backend `documents.email.js`: dejar `sendDocumentEmail` pero NO llamarlo desde el generador
- Endpoint `GET /documents/:id/email-preview`
- Endpoint `POST /documents/:id/send {subject?, htmlContent?}`
- Frontend `DocumentEmailPreviewDialog.tsx`: dialog con asunto editable + cuerpo HTML + lista destinatarios + adjunto + botón "Confirmar"
- Quitar la llamada auto del generador

H.2. **Lead-asignado: campanita + digest** (ambos CRMs)
- Backend `lead.service.js`: cambiar `sendLeadAssignedEmail` por `notifyUsers({targetUserIds:[gestor.id], type:'lead_assigned', ...})` SIEMPRE
- Nuevo `jobs/leadDigestScheduler.js`: cada 30 min, agrupar leads por gestor y enviar 1 email con resumen
- Migración: tabla `lead_assigned_pending` (gestor_id, lead_id, created_at, notified_at) para el digest

H.3. **Documentar política en el `manual`** (ya está este `.md`).

---

## 4. Cambios en este documento

- 2026-06-12 — Documento creado. Decisiones 1.1 y 1.2 aprobadas en chat.
