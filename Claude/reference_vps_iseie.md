---
name: reference-vps-iseie
description: "VPS de CRM-ISEIE (72.60.90.135) — credenciales root, layout, DB, PM2"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---

VPS de **CRM-ISEIE** (repo hermano del CRM principal, ver [[project-crm-overview]]).

**Datos**:
- IP: `72.60.90.135`
- Hostname: `srv965687`
- OS: Ubuntu 22.04.5 LTS
- SSH: `root@72.60.90.135` · password `1234567890ASDa,` (la misma que Manuel usa para Samantha/staging del CRM principal)
- Usar `paramiko` (no `sshpass` — no está instalado en Windows local) para SSH automatizado:
  ```python
  c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
  c.connect('72.60.90.135', username='root', password='1234567890ASDa,', timeout=15)
  ```

**DB**:
- `crm_iseie` con owner `crm_iseie_user`
- Pass del DB user (de `.env` local): `!AWL=V7jSDwAKo(tA4eLrW*u`
- Conexión local vía túnel SSH:
  ```bash
  ssh -N -L 5433:127.0.0.1:5432 root@72.60.90.135
  ```

**PM2** (compartido con otras apps — NO TOCAR las ajenas):
- `crm-iseie-api` (id 4, puerto 3005, fork mode, user root) — **el del CRM**
- prerender-opynio, psicologo-ia-pro, veterinary-ai — ajenas, intactas hace 12d+

**URL pública**: https://crm.iseie.com (SSL Let's Encrypt)

**Layout en VPS**: probablemente `/opt/crm-iseie/` y `/var/www/crm-iseie/` (confirmar antes de tocar). Ver `vps-72.60.90.135-handoff.md` del repo para detalle de los 8 sitios productivos coexistiendo.

**Diferencia clave vs CRM hermano**:
- Repo: `esos2dev-oss/CRM-ISEIE` (no `CRM`)
- Branches: `main` (prod) + `staging`
- Schema simplificado: 1 solo proyecto (`iseie`, id=10), 58 tablas, sin features IA, sin algunas columnas de leads (deleted_reason/motivo, custom_fields, reincidente, es_propuesto)
- Stubs en `lead.model.js` y `lead.service.js` para esas columnas faltantes
