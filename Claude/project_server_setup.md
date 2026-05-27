---
name: Server infrastructure setup
description: VPS setup completed 2026-04-06 - Node, PG17, PM2, SSH tunnel required for pgAdmin
type: project
---

Server infra completed on 2026-04-06.

- Ubuntu 25.04 (Plucky Puffin), 4GB RAM, 48GB disk, 1 CPU
- Node.js v24.14.1 LTS via nvm, PM2 6.0.14 with systemd startup
- PostgreSQL 17.7 (not 16 - Ubuntu 25.04 incompatible with PG16 libicu74)
- DB: crm_db, user: crm_user, encoding UTF-8
- User `claude` with sudo NOPASSWD and SSH key auth
- Port 5432 blocked externally by ISP/Hostinger - use SSH tunnel: `ssh -f -N -L 15432:localhost:5432 claude@187.124.128.126`
- pgAdmin connects via 127.0.0.1:15432, SSL mode disable

**Why:** CRM-25, CRM-27, CRM-33 completed. Infra foundation for all backend work.
**How to apply:** Always use SSH tunnel for DB access. Connect to server as `claude` user via SSH key. Next: Nginx (CRM-26).
