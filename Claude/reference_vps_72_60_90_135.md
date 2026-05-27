---
name: VPS Hostinger 72.60.90.135 — segundo servidor
description: VPS adicional con 8 sitios productivos donde el equipo de luis-dev monta otro CRM (encapsulado, no toca lo existente)
type: reference
originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---
VPS distinto del de producción (187.124.128.126). Hostname `srv965687`, Ubuntu 22.04, 2 cores / 7.8GB RAM / 100GB disk.

**Acceso:**
- `ssh root@72.60.90.135` (password compartido por Diego)
- `ssh luis-dev@72.60.90.135` password `crm-iseie` — usuario nuevo creado para el equipo del CRM ISEIH montado allí

**Apps en producción que NO se pueden tocar (PM2 root):**
- prerender-opynio, psicologo-ia-pro (puerto 3004), veterinary-ai (puerto 3003)
- Más nodes en puertos 3001, 3002

**Stack disponible:** Node 20.19, npm 10.8, PM2 6.0.14, nginx 1.18, MariaDB 10.6, PHP 8.1-FPM, Python 3.10. NO hay PostgreSQL ni Docker — instalar si el nuevo CRM lo requiere.

**Doc completa:** `Claude/vps-72.60.90.135-handoff.md` con la auditoría completa y reglas de "no tocar".

**Para nuevas apps:** usar puertos 3005+, dirs `/opt/crm-iseih` + `/var/www/crm-iseih`, su propio `pm2-luis-dev.service` para no mezclar con el de root.
