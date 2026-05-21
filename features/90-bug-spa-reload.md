# Fix SPA reload — paginas recargaban completo

**Jira:** CRM-188
**Estado:** ✅ Implementado
**Tipo:** Bug fix

## Contexto

Al clickear algunos botones (regenerar webhook key, boton "Reintentar" en errors), el navegador hacia full page reload en lugar de re-fetch SPA. Rompe el flujo y hace sensacion de app no-SPA.

## Causas detectadas (3)

1. `ProjectSettingsDialog > WebhookTab.regenerate()` llamaba `location.reload()` tras el POST
2. `LeadDetailPage` en error state tenia boton Reintentar que llamaba `window.location.reload()`
3. `DashboardPage` mismo patron

## Fix

1. **WebhookTab**: apiKey ahora es state local (`useState`), `regenerate()` actualiza con `setApiKey(res.data.webhook_api_key)` y `setRevealed(true)` para que se vea la nueva
2. **LeadDetailPage**: usa `refetch` ya expuesto por `useLeadDetail()`
3. **DashboardPage**: usa `refetch` ya expuesto por `useDashboard()`

## Falsos positivos

- `LeadFormDialog` tiene `<a href="/leads/X" target="_blank">` — NO es bug, es intencional (abrir duplicado en nueva pestaña)
- Usos de `window.location.origin` para construir URLs — OK, son lecturas sin navegacion

## QA

- Test manual: regenerar webhook key en Configurar > Webhook → no recarga, key se actualiza inline
- Test manual: simular error en LeadDetail o Dashboard → boton Reintentar re-fetch sin reload

## Commits

- `56935d4` fix(CRM-188): SPA reload + favicon dinamico por proyecto
