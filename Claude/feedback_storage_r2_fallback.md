---
name: Storage pattern R2 fallback local
description: R2 no esta configurado, usar disco local por defecto. Patron para migrar despues sin romper
type: feedback
originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---
R2 (Cloudflare) quedo sin configurar durante BETA. Las env vars `CLOUDFLARE_R2_*` no estan en `/opt/crm/staging/.env` y el usuario prefirio no proveerlas todavia.

**Regla:** toda feature que necesite guardar archivos debe usar `backend/src/shared/services/localStorage.service.js` (`saveLocal`, `getLocal`, `deleteLocal`), NO `r2.service.js`.

Default dir: `/var/crm-uploads/` (configurable via env `UPLOADS_DIR`). Sobrevive a redeploy porque esta fuera de `/opt/crm/staging/`.

**Why:** no bloquear features por falta de credenciales cloud. El patron es un drop-in replacement; cuando se configure R2 con las credenciales, solo cambiar el import en los controllers (`saveLocal` → `uploadToR2`) y seguir. La interfaz es identica.

**How to apply:**
- Para logos, avatars, comprobantes, dossiers nuevos, imagenes de productos: **usar `localStorage.service`**.
- El dossiers module existente sigue usando R2 (pendiente de migrar si se necesita probar antes de tener R2).
- Cuando el usuario provea las credenciales R2, crear un `storage.service` unificado que haga el fallback automatico (si env `CLOUDFLARE_R2_BUCKET` vacio → local, sino R2).
- Ya configurado en servidor: `mkdir -p /var/crm-uploads/logos && chown claude:claude /var/crm-uploads`.

**Incidente que motivo esto:** CRM-182. Logos subidos pero GET daba 404 porque findById/findAll del project.model.js no incluian logo_url/logo_key en el SELECT. Fix: añadidos a las queries. Ademas el upload daba 500 porque CLOUDFLARE_R2_BUCKET vacio. Fix: disco local.
