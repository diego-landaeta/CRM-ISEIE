# Backup pre-Sprint 1 Finanzas + procedimiento de rollback

**Fecha**: 2026-06-12 (tomado a las 17:44–17:45 UTC)
**Motivo**: punto de retorno seguro antes de arrancar EPIC A — Auditoría de Finanzas y las épicas que vienen después.

---

## 1. Git tags

Snapshot del HEAD de `main` en ambos repos antes de cualquier cambio en `feat/finanzas-sprint1`:

| Repo | Tag | Commit |
|---|---|---|
| CRM ISEIE | `pre-finanzas-sprint1` | `fee271f7a763b77343eb2d7df623540e3549c3fa` |
| CRM ISEIH | `pre-finanzas-sprint1` | `61f6eeab46a31304bb4225ecfeb37132e1f9da93` |

**Verificación**:
```bash
# ISEIE
git ls-remote --tags origin pre-finanzas-sprint1
# ISEIH
git ls-remote --tags origin pre-finanzas-sprint1
```

---

## 2. Backups en los VPS

### CRM ISEIH (VPS 187.124.128.126)

**Directorio**: `/var/backups/crm/pre-finanzas-sprint1-20260611_174433/`

| Artefacto | Tamaño | Contenido |
|---|---|---|
| `crm_prod_db.sql.gz` | 5.5 MB | `pg_dump crm_prod_db` completo (esquemas + datos + secuencias) |
| `frontend.tar.gz` | 1.4 MB | `/var/www/crm/production/frontend/` completo (assets, index.html, sw.js) |
| `uploads.tar.gz` | 134 B | `/opt/crm/production/uploads/` (vacío hoy — sin documentos generados) |
| `.env.backup` | 586 B | `.env` del backend (DATABASE_URL, JWT_SECRET, BREVO_API_KEY, etc.) |
| `ecosystem.config.js` | 252 B | Config PM2 (puerto, env vars, max_memory) |

### CRM ISEIE (VPS 72.60.90.135)

**Directorio**: `/var/backups/crm-iseie/pre-finanzas-sprint1-20260611_174500/`

| Artefacto | Tamaño | Contenido |
|---|---|---|
| `crm_iseie.sql.gz` | 5.2 MB | `pg_dump crm_iseie` completo |
| `frontend.tar.gz` | 748 KB | `/var/www/crm-iseie/` completo |
| `uploads.tar.gz` | 156 B | `/opt/crm-iseie/uploads/` (vacío) |
| `.env.backup` | 553 B | `.env` del backend |
| `ecosystem.config.js` | — | No existe (PM2 levantado a mano) |

---

## 3. Procedimiento de rollback (si algo explota)

### 3.1. Rollback solo de código (rápido)

Si el problema es exclusivamente código (un commit rompió algo y la DB sigue OK):

**Backend ISEIH**:
```bash
ssh claude@187.124.128.126
cd /opt/crm/production
sudo -u root git fetch origin
sudo -u root git checkout pre-finanzas-sprint1
sudo cp /var/backups/crm/pre-finanzas-sprint1-*/ecosystem.config.js .
pm2 restart crm-api-production
```

**Backend ISEIE**:
```bash
ssh root@72.60.90.135  # password 1234567890ASDa,
cd /opt/crm-iseie
git fetch origin
git checkout pre-finanzas-sprint1
pm2 restart crm-iseie-api
```

**Frontend (ambos)**: hacer build en local desde el tag y subirlo:
```bash
# local
git checkout pre-finanzas-sprint1
cd frontend && npm run build
tar czf /tmp/rollback.tgz -C dist .
scp /tmp/rollback.tgz <vps>:/tmp/
# remoto
sudo rm -rf /var/www/<sitio>/{assets,index.html}
sudo tar xzf /tmp/rollback.tgz -C /var/www/<sitio>/
sudo chown -R www-data:www-data /var/www/<sitio>/
```

### 3.2. Rollback completo (con datos)

Si una migración corrupta dañó datos o se borró algo en producción.

**ISEIH**:
```bash
# Parar el backend
pm2 stop crm-api-production

# Restaurar DB
sudo -u postgres dropdb crm_prod_db
sudo -u postgres createdb -O crm_user crm_prod_db
zcat /var/backups/crm/pre-finanzas-sprint1-20260611_174433/crm_prod_db.sql.gz | sudo -u postgres psql crm_prod_db

# Restaurar uploads y frontend
sudo tar xzf /var/backups/crm/pre-finanzas-sprint1-20260611_174433/uploads.tar.gz -C /opt/crm/production/
sudo rm -rf /var/www/crm/production/frontend
sudo tar xzf /var/backups/crm/pre-finanzas-sprint1-20260611_174433/frontend.tar.gz -C /var/www/crm/production/
sudo chown -R www-data:www-data /var/www/crm/production/

# Restaurar .env si se tocó
sudo cp /var/backups/crm/pre-finanzas-sprint1-20260611_174433/.env.backup /opt/crm/production/.env

# Restaurar código (igual que 3.1)
cd /opt/crm/production && git checkout pre-finanzas-sprint1

# Arrancar
pm2 start crm-api-production
```

**ISEIE**: mismo procedimiento sustituyendo paths.

### 3.3. Rollback parcial (solo una migración)

Si solo una migración específica (ej. `080_xxx.sql`) rompió algo:

```sql
-- Identificar qué hizo y revertir manualmente
-- (cada migración debería tener su rollback documentado en el header del .sql)
```

Para esto necesitamos disciplina futura: **toda migración nueva tendrá un comentario `-- ROLLBACK: ...` al pie del archivo**.

---

## 4. Validación post-rollback

Después de cualquier rollback ejecutar:

1. **HTTP health check**:
   ```bash
   curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://360crm.tech/crm/api/health
   curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://crm.iseie.com/api/health
   ```
   Debe devolver `200`.

2. **Smoke leads** (lo que verificamos hoy):
   - Login con superadmin
   - Crear interacción manual en un lead
   - Cambiar estado
   - Programar recordatorio
   Todo debe funcionar.

3. **Conteos DB**:
   ```sql
   SELECT COUNT(*) FROM leads;
   SELECT COUNT(*) FROM conversions;
   SELECT COUNT(*) FROM products;
   ```
   Deben coincidir con los del backup (anotados antes en `docs/10`).

---

## 5. Limpieza de backups antiguos

Política sugerida: mantener los últimos 30 días + el tag `pre-finanzas-sprint1` indefinidamente hasta cerrar Sprint 1.

```bash
# Limpia backups con más de 30 días excepto los etiquetados como "pre-*"
find /var/backups/crm/ -type d -mtime +30 -not -name 'pre-*' -exec rm -rf {} +
```

---

## 6. Cambios en este documento

- 2026-06-12 — Documento creado. Backup tomado a las 17:44–17:45 UTC.
