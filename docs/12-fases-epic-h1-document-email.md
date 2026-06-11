# EPIC H.1 — Email de documentos manual + preview

**Rama**: `feat/finanzas-sprint1` (ambos CRMs)
**Tracking por commit**: cada fase = 1 commit como mínimo. Si una fase necesita iterar, se hacen más commits dentro de la misma fase.
**Aplicabilidad**: CRM ISEIE y CRM ISEIH en paralelo.
**Owner**: Diego.
**Stakeholder**: Manuel (CEO).

---

## Objetivo

Que **ningún documento PDF generado por el CRM se envíe automáticamente por email**. El gestor debe:
1. Generar el documento (matrícula, certificado, recibo, dossier)
2. Verlo en `/documentos`
3. Pulsar **"Enviar al cliente"**
4. Revisar el **preview** (asunto + cuerpo HTML + adjunto + destinatarios)
5. **Confirmar** — solo entonces sale a Brevo

Motivo: Brevo cuota 300/día (free). Evitar emails que se disparan sin que el equipo vea qué se envió. Cumplir auditoría.

---

## Fases (5)

### Fase 1 — Auditoría (read-only) ⏳

- [ ] Catalogar **todos los flujos que generan PDF** en cada CRM (matrículas, conversiones, dossiers, RFC, manuales)
- [ ] Por flujo: archivo generador + endpoint + frontend trigger + si auto-envía email + a quién + qué template
- [ ] Listado completo de invocaciones de `sendDocumentEmail` / `sendEmail` desde el módulo `documents/`
- [ ] Conteo en DB de docs generados / enviados / fallidos en producción
- [ ] Detectar si la tabla `lead_emails` sirve para tracking del envío o necesitamos columna nueva en `documents`
- [ ] Localizar tests existentes (vitest) del módulo documents
- [ ] **Entregable**: tabla resumen + plan detallado de Fase 2 con file:line exactos

**Commit**: `docs(epic-h1): fase 1 - auditoría flujo actual email documentos`

---

### Fase 2 — Backend (preview + send con override) ⏳

- [ ] **Quitar todas las llamadas auto a `sendDocumentEmail`** desde generadores. El PDF se sigue generando pero ya no sale a Brevo solo.
- [ ] **Nuevo endpoint** `GET /api/documents/:id/email-preview` → `{to, default_subject, default_body_html, attachment{name,size_kb}, lead_id, project_id, already_sent, last_sent_at}`
- [ ] **Modificar** `POST /api/documents/:id/send` para aceptar `{subject?, html_content?, to?}` opcional. Si vienen vacíos usa los defaults.
- [ ] Si Brevo no configurado → **503** con mensaje claro `"Brevo no configurado, no se envió"`
- [ ] Si OK → registrar en `lead_emails` + marcar `documents.email_sent_at = NOW()` (migration si la columna no existe)
- [ ] **Rate-limit** por documento: máx 5 envíos del mismo doc en 1h
- [ ] **Validación Zod** en `documents.validation.js`
- [ ] Auth: `verifyToken + roleGuard('admin','superadmin','gestor')` + project-access
- [ ] Tests pasan (vitest si existen) + `node --check`
- [ ] **Deploy backend a producción ambos VPS** — estado intermedio seguro: nada se envía hasta Fase 3

**Commit(s)**: 
- `feat(documents/h1): endpoint email-preview + quitar auto-send`
- `feat(documents/h1): POST send con override + rate-limit`
- `feat(documents/h1): migration documents.email_sent_at`

---

### Fase 3 — Frontend dialog preview ⏳

- [ ] Botón **"Enviar al cliente"** en `/documentos/:id` (detail page)
- [ ] Componente nuevo `DocumentEmailPreviewDialog.tsx`:
  - Carga `GET /documents/:id/email-preview` al abrir
  - Muestra destinatarios (editables: añadir/quitar)
  - Asunto editable (con default)
  - Cuerpo HTML editable (textarea grande, idealmente con preview lado a lado o tab)
  - Adjunto info (nombre + tamaño)
  - Botón "Cancelar" + "Confirmar envío"
- [ ] Toast de éxito / error tras confirmar
- [ ] Si ya se envió antes → muestra `already_sent` + `last_sent_at` con aviso "¿Reenviar?"
- [ ] Replicar el mismo componente en ISEIH (mismo módulo `documents`)
- [ ] Build OK ambos CRMs
- [ ] **Deploy frontend ambos VPS**

**Commit(s)**:
- `feat(documents/h1): DocumentEmailPreviewDialog component`
- `feat(documents/h1): botón enviar al cliente + dialog wired up`

---

### Fase 4 — Tests + smoke en producción ⏳

- [ ] Generar un documento de prueba en producción (ambos CRMs)
- [ ] Verificar que **NO se envió email automático** (logs limpios)
- [ ] Pulsar "Enviar al cliente" → dialog se abre con defaults correctos
- [ ] Editar subject y body
- [ ] Confirmar → email llega (a mi propia cuenta de prueba)
- [ ] Verificar `lead_emails` + `documents.email_sent_at` actualizados
- [ ] Probar rate-limit: 6 envíos seguidos → el 6º falla con 429
- [ ] Probar sin Brevo configurado → 503 con mensaje útil
- [ ] Cleanup datos de prueba

**Commit**: (sin código nuevo, solo verificación) — opcional dejar log en el doc

---

### Fase 5 — Docs + cierre de epic ⏳

- [ ] Actualizar `docs/11-politica-emails-brevo.md` con el flujo definitivo
- [ ] Anotar la entrada en el `manual del CRM` (sección Documentos → Enviar al cliente)
- [ ] Tachar EPIC H.1 en el plan general del sprint
- [ ] **Merge `feat/finanzas-sprint1` → `main`** (vía PR si quieres revisión o directo si confías)
- [ ] Deploy main a producción (ambos CRMs)
- [ ] Smoke final en producción

**Commit**: `docs(epic-h1): cierre + manual del CRM`

---

## Cómo seguir el progreso

- Esta rama (`feat/finanzas-sprint1`) acumula commits de TODAS las épicas de Finanzas, no solo H.1. Mientras vamos por fases, el `main` se queda intocado y la producción sigue con la versión estable.
- Si surge un hotfix urgente para producción → se hace en `main` directo o en rama propia.
- Al terminar cada épica completa (no cada fase), se hace **merge a main + deploy**. Las fases intermedias pueden vivir en la rama sin deployar.
- Excepción: **Fase 2 SÍ se deploya** porque quita el auto-send (lo que queremos urgente). Es estado intermedio seguro.

## Convención de commits

- Prefijo: `feat(documents/h1):`, `docs(epic-h1):`, `fix(epic-h1):`
- Mensaje en español
- Co-author: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`

---

## Cambios en este documento

- 2026-06-12 — Documento creado en `feat/finanzas-sprint1` ambos CRMs.
