# BACKUP — procedimiento CRM-ISEIE (PREPRODUCCIÓN)

> ⚠️ **Este backup es SOLO para preproducción/testing, NO para producción.**
> Producción tiene su propio backup automático (cron diario en `/var/backups/` del VPS — no se toca desde acá).
>
> Este flujo sirve para:
> - Levantar una copia de preprod local o en otro server
> - Snapshot del repo para una IA/dev que va a probar cambios
> - Restore puntual para testing
> - Anonimizar datos antes de compartir con tercero

---

## Qué se respalda

| Componente | Origen | Tamaño | Script |
|---|---|---|---|
| **Repo código + .git + docs** | local (Windows) | ~14 MB | `Claude/scripts/backup_repo.sh` |
| **DB anonimizada** (emails/teléfonos hasheados) | preprod opcional | ~25 MB | `Claude/scripts/backup_db_anon.sh` |

⛔ NO incluido (intencional):
- `.env` con credenciales reales
- `node_modules/`, `dist/`
- Datos reales sin anonimizar de leads/clientes (PII)
- Uploads originales con info personal

---

## Quickstart

```bash
# Desde la raíz del repo, en local
bash Claude/scripts/backup_repo.sh
# → genera ./backups/repo_YYYYMMDD_HHMM.tgz
```

Para DB anonimizada (requiere acceso a la preprod DB, NO prod):

```bash
bash Claude/scripts/backup_db_anon.sh
# → genera ./backups/db_anon_YYYYMMDD_HHMM.dump
# emails y teléfonos pasan a hash MD5, nombres a "Usuario N"
```

---

## Scripts incluidos en `Claude/scripts/`

- `backup_repo.sh` — tarball del repo (sin node_modules ni dist)
- `backup_db_anon.sh` — dump de preprod con PII anonimizada
- `restore_repo.sh` — extrae tarball en folder destino + npm install
- `restore_db.sh` — restaura dump a una DB destino (NO prod)

---

## Restore en preprod local

```bash
# 1) Repo
tar -xzf backups/repo_20260531_1830.tgz -C ~/test/
cd "~/test/CRM ISEIE"
cd backend && npm install && cp .env.example .env  # editar con DB local
cd ../frontend && npm install

# 2) DB (en una PG local separada de prod)
createdb crm_iseie_preprod
PGPASSWORD=local pg_restore -h localhost -U postgres -d crm_iseie_preprod backups/db_anon_20260531_1830.dump

# 3) Levantar
cd backend && npm run dev   # :3005
cd ../frontend && npm run dev  # :5173
```

---

## Reglas críticas

1. **NUNCA correr `backup_db_anon.sh` apuntando a `crm_iseie` de producción** sin anonimización previa
2. **NUNCA committear** los `.dump` ni los `.tgz` al repo (ya están en `.gitignore`)
3. **NUNCA compartir** dumps sin anonimizar fuera del equipo
4. **Para snapshot de prod** usar el cron automático del VPS, NO este flujo
