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

### 1.2. Email de **lead asignado al gestor** → digest 30 min (solo si hay leads nuevos)
- **Aplica a**: notificación al gestor cuando entra un lead por webhook y se le asigna.
- **Antes**: cada lead = 1 email a la gestora correspondiente. ISEIE quemaba 80–160 emails/día solo por esto.
- **Ahora**: 3 capas:
  1. **Campanita in-app SIEMPRE** (canal principal, sin coste, igual que recordatorios) — la gestora la ve al instante si está conectada
  2. **Toast/badge en el sidebar** si está dentro del CRM
  3. **Email digest cada 30 min** por gestora con todos los leads acumulados en ese intervalo:
     - Si en 30 min entran 20 leads → 1 email con 20
     - Si entra 1 → 1 email con 1
     - **⚠ Si NO entró ningún lead → NO se manda email** (cero spam de "no tienes nada")
     - Configurable: `EMAIL_DIGEST_INTERVAL_MIN=30` en `.env` (poner `0` desactiva email, solo campanita)
     - Origen filtro: solo leads con `source='webhook'` o `source='mailhook'` (web). Los manuales/import no disparan digest.

**Estimación de ahorro con digest 30 min en ISEIE**:
- Antes: 86 leads × 1 email = **86 emails/día**
- Después: ~48 ventanas de 30min × N gestoras (~3–5) × (~50% con actividad) = **~5–15 emails/día**
- Ahorro: 80–95%

### 1.3. **Recordatorio diario 24h antes** — "Mañana tienes pendientes"
- **Objetivo**: la gestora abre su buzón por la mañana / al final del día y ve qué le toca mañana.
- **Frecuencia**: 1 email/gestora/día a las **18:00 Madrid** con los recordatorios + leads cuya `fecha_recordatorio = mañana` (D+1).
- **Contenido**: lista compacta:
  ```
  Hola Catherine,

  Mañana 13-jun tienes 5 contactos pendientes:

  • Daniela Cordero — Curso Logopedia
    nota: "llamar después de las 17h"
  • Pedro García — Diplomado RGPD
  • Sofía Pérez — Máster Análisis IA
    nota: "preguntó por descuento"
  ...

  Ver tu agenda completa: https://360crm.tech/crm/leads?filtro=manana
  ```
- **Filtro**: solo se manda si la gestora tiene **al menos 1 recordatorio** para mañana. Si no hay, no envía.
- **Excluye**: leads en estado `convertido`, `no_interesado`, `descartado`, `deleted_at IS NOT NULL`.
- **Implementación**: job nuevo `dailyAgendaScheduler.js` corre a las 18:00 (cron `0 18 * * *`). Por cada gestora activa: cuenta sus reminders de mañana → si > 0 → envía 1 email con la lista.
- **Coste estimado**: 1 email × N gestoras × días con actividad. En ISEIE: ~5 gestoras × 22 días/mes = **~110 emails/mes**. Despreciable.

---

## 2. Catálogo de flujos que SÍ deben ir por email (los necesarios)

| Flujo | Cuándo dispara | Volumen estimado/día | Mantener email |
|---|---|---|---|
| Welcome al nuevo user (set-password) | Superadmin crea user | ~0–2/día | ✅ Sí, es 1 toque y el user lo necesita para entrar |
| Recordatorios vencidos | Reminder scheduler | ~5–20/día | ⚠ Campanita ya cumple. Email solo si Brevo configurado, best-effort (no bloquea). |
| **Agenda de mañana (digest diario 18h)** | dailyAgendaScheduler | ~3–5/día | ✅ Sí — 1 email/gestora/día con sus recordatorios de D+1, solo si tiene |
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

H.2. **Lead-asignado: campanita + digest 30min (solo si hay)** (ambos CRMs)
- Backend `lead.service.js`: cambiar `sendLeadAssignedEmail` por `notifyUsers({targetUserIds:[gestor.id], type:'lead_assigned', ...})` SIEMPRE
- Nuevo `jobs/leadDigestScheduler.js`: cada 30 min, agrupar leads por gestor con `source IN ('webhook','mailhook')` y `created_at > NOW() - 30min` y `digest_sent_at IS NULL`. **Si la lista está vacía para esa gestora → no envía nada.**
- Migración: añadir `digest_sent_at TIMESTAMPTZ` a `leads` (default NULL) — se marca cuando entra al digest.

H.3. **Agenda de mañana: digest diario 18h** (ambos CRMs)
- Nuevo `jobs/dailyAgendaScheduler.js`: corre a las 18:00 Europe/Madrid (cron `0 18 * * *` o `setInterval` con check horario).
- Por cada gestora activa: query `SELECT * FROM lead_reminders r JOIN leads l ... WHERE l.responsable_id=$1 AND r.fecha_recordatorio = CURRENT_DATE + 1 AND r.completado=false AND l.deleted_at IS NULL AND l.status NOT IN ('convertido','no_interesado','descartado')`.
- Si `count > 0` → enviar 1 email con la lista compacta + link al CRM con filtro "mañana".
- Si `count = 0` → no enviar nada (sin spam).
- Logging por gestora para auditoría.

H.4. **Documentar política en el `manual`** (ya está este `.md`).

---

## 4. Cambios en este documento

- 2026-06-12 — Documento creado. Decisiones 1.1 y 1.2 aprobadas en chat.
- 2026-06-12 (b) — Añadidas: digest 30min NO envía si no hay leads. Nueva 1.3 "Agenda de mañana 18h" (recordatorio diario con los pendientes de D+1, solo si hay).
