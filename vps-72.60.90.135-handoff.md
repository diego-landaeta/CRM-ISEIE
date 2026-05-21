# VPS 72.60.90.135 — Estado actual y guía para nuevo CRM

> **⚠️ LEER ANTES DE TOCAR NADA.** Este servidor tiene 8 sitios productivos y varias apps Node corriendo desde hace 48 días sin reinicio. El nuevo CRM se monta **encapsulado**, sin afectar nada de lo que ya está aquí.

---

## 1. Datos básicos del servidor

| | |
|---|---|
| **Hostname** | srv965687 |
| **IP pública** | 72.60.90.135 |
| **OS** | Ubuntu 22.04.5 LTS (jammy) |
| **Kernel** | 5.15.0-173-generic |
| **CPUs** | 2 cores |
| **RAM** | 7.8 GB (uso actual ~900 MB) |
| **Disco** | 100 GB / (uso 8.2 GB → 9 %) |
| **Swap** | 0 — no hay swap configurada |
| **Uptime** | 48 días |
| **Zona horaria** | UTC |

---

## 2. Acceso

```
ssh root@72.60.90.135        # acceso principal del equipo del CRM
ssh ubuntu@72.60.90.135      # usuario sudo preexistente con clave SSH
```

### Credenciales

El password de `root` y cualquier otra credencial sensible vive **solo** en [`fase-1/CREDENCIALES-PRIVADO.md`](fase-1/CREDENCIALES-PRIVADO.md), que está en `.gitignore` y nunca se commitea. El usuario rellena ese archivo localmente.

**Recomendación a futuro:** subir clave pública SSH y deshabilitar password auth (`PasswordAuthentication no` en `/etc/ssh/sshd_config`).

---

## 3. ⛔ NO TOCAR — Servicios y apps en producción

### 3.1 Servicios systemd activos (NO detener, NO modificar)

| Servicio | Función |
|---|---|
| `nginx` | Proxy reverso HTTPS, sirve TODOS los sitios |
| `mariadb` (10.6) | DB en `127.0.0.1:3306` — usa varias apps |
| `php8.1-fpm` | PHP de los sitios `opynio.com` / `es.opynio.com` |
| `pm2-root` | Gestor de procesos con 3 apps Node críticas |
| `prerender.service` | Server prerender para SEO |
| `ssh`, `cron`, `unattended-upgrades` | Sistema base |

### 3.2 PM2 — apps Node en producción (gestionadas por root)

```
┌────┬────────────────────┬──────┬────────┐
│ id │ name               │ pid  │ uptime │
├────┼────────────────────┼──────┼────────┤
│ 1  │ prerender-opynio   │ 24248│ 48D    │
│ 2  │ veterinary-ai      │ 940  │ 48D    │
│ 7  │ psicologo-ia-pro   │ 40188│ 47D    │
└────┴────────────────────┴──────┴────────┘
```

**Comando que las administra todas:** `pm2 ...` (al estar como root, comparte el daemon con nuestras apps; ver §7 sobre disciplina operativa).

### 3.3 Procesos Node escuchando en puertos (NO usar estos puertos)

| Puerto | Proceso | Ruta |
|---|---|---|
| **3001** | node `server.js` | (cwd raíz, prerender simple) |
| **3002** | node prerender | `/var/www/web.opynio.com/prerender/` |
| **3003** | node | `/var/www/app.veterinaryai.ai/server/` |
| **3004** | node | `/var/www/pro.psicologoia.ai/dist/` |

### 3.4 Sitios Nginx activos (12 dominios)

```
/etc/nginx/sites-enabled/
├── app.nutricionistaia.ai      → /var/www/app.nutricionistaia.ai/public/dist  (estático)
├── app.opynio.com              → SPA + backend
├── app.psicologoia.ai          → /var/www/app.psicologoia.ai/public/dist      (estático)
├── app.tarotia.ai              → /var/www/app.tarotia.ai/public/dist          (estático)
├── app.trabajosuniversitarios.ai → /var/www/app.trabajosuniversitarios.ai/public/dist
├── app.veterinaryai.ai         → proxy_pass 127.0.0.1:3003
├── crm                         → bind a IP 72.60.90.135 path /CRM (vacío, reservado)
├── es.opynio.com               → /var/www/es.opynio.com/public  (PHP)
├── opynio.com                  → /var/www/opynio.com  (estático/PHP)
├── pro.psicologoia.ai          → proxy_pass 127.0.0.1:3004
├── web.opynio.com              → SPA + proxy 127.0.0.1:3002 + supabase functions
└── yourcvpassport.com          → SPA + supabase functions
```

### 3.5 Certificados SSL (Let's Encrypt) — NO renovarlos manualmente

`/etc/letsencrypt/live/` contiene certificados para todos los dominios listados arriba.

⚠️ **Atención:** `certbot.service` está actualmente en estado **failed**. Los certs siguen vigentes pero el auto-renew falla. NO es responsabilidad del nuevo CRM, pero el equipo actual debería revisarlo.

### 3.6 Archivos sensibles (NO leer ni mover)

- `/var/www/.env` — variables globales compartidas entre apps
- `/var/www/pro.psicologoia.ai.env.backup` — backup
- `/root/.ssh/`, `/root/.pm2/`, `/root/.npm/`, `/root/.nvm/` — entorno root
- `/etc/letsencrypt/` — certificados

---

## 4. ✅ Lo que SÍ puede usar el nuevo CRM

### 4.1 Recursos disponibles

- **CPU:** baja carga (load avg ~0.04)
- **RAM:** 6.6 GB libres
- **Disco:** 89 GB libres
- **Hay margen de sobra** para una app más

### 4.2 Stack instalado y reutilizable

| Herramienta | Versión | Comentario |
|---|---|---|
| Node.js | v20.19.6 (`/usr/bin/node`) | Vía nvm también disponible en root |
| npm | 10.8.2 | |
| PM2 | 6.0.14 (`/usr/local/bin/pm2`) | Global |
| nginx | 1.18.0 | Compartido — añadir nuevo sitio en `sites-available` |
| Git | 2.34.1 | |
| Python3 | 3.10.12 | |
| MariaDB | 10.6.22 | Compartida — crear DB y usuario propios |

### 4.3 Lo que NO está instalado (instalar si se necesita)

- ❌ **PostgreSQL** — no instalado. Si el CRM ISEIH lo requiere (lo requiere): `sudo apt install postgresql-15`
- ❌ **Docker** — no instalado
- ❌ **Redis** — no instalado
- ❌ **pnpm / yarn** — no instalados (usar npm)

### 4.4 Puertos libres recomendados

Los puertos 3001-3004 están ocupados. Para el nuevo CRM usar:
- **3005, 3006, 3007** — recomendados para backend/frontend del nuevo CRM
- 5432 si se instala PostgreSQL (estándar)

### 4.5 Firewall (UFW activo)

```
22/tcp   ALLOW  (SSH)
80/tcp   ALLOW
443/tcp  ALLOW
```

⚠️ Solo 22, 80 y 443 están abiertos al exterior. El nuevo CRM debe ir **detrás de nginx** en un subdominio. NO abrir puertos extras al exterior.

---

## 5. Convenciones para el nuevo CRM

### 5.1 Estructura de directorios sugerida

```bash
# NO usar /var/www/crm (existe vacío pero está reservado/ambiguo)
mkdir -p /opt/crm-iseih               # backend
mkdir -p /var/www/crm-iseih           # frontend estático
```

### 5.2 Base de datos PostgreSQL (recomendado para el nuevo CRM)

```bash
sudo apt update && sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql
```
```sql
CREATE USER crm_iseih_user WITH PASSWORD '<password seguro>';
CREATE DATABASE crm_iseih OWNER crm_iseih_user;
\q
```

PostgreSQL escucha por defecto en `127.0.0.1:5432` — no expuesto al exterior, perfecto.

### 5.3 Alternativa: usar MariaDB existente

Si el equipo prefiere MariaDB:
```bash
sudo mariadb
```
```sql
CREATE DATABASE crm_iseih CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'crm_iseih_user'@'localhost' IDENTIFIED BY '<password>';
GRANT ALL PRIVILEGES ON crm_iseih.* TO 'crm_iseih_user'@'localhost';
FLUSH PRIVILEGES;
```

⚠️ **No tocar** las DBs existentes. `SHOW DATABASES;` para confirmar nombres ya en uso antes de crear.

### 5.4 Nginx — añadir nuevo sitio

```bash
sudo nano /etc/nginx/sites-available/crm-iseih.midominio.com
```

```nginx
server {
    listen 80;
    server_name crm-iseih.midominio.com;

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/crm-iseih.midominio.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d crm-iseih.midominio.com    # SSL automático
```

### 5.5 PM2 (apps gestionadas por root)

```bash
# Como root
pm2 start ecosystem.config.js --name crm-iseih-api
pm2 save
```

Esto añade la app al `pm2-root.service` ya existente (el que también corre `prerender-opynio`, `veterinary-ai`, `psicologo-ia-pro`).

> ⚠️ **Cuidado:** al ser root, `pm2 list` / `pm2 delete` / `pm2 restart` afectan a todas las apps del servidor, no solo al CRM. Usar nombres explícitos (`pm2 restart crm-iseih-api`), nunca `pm2 restart all`.

---

## 6. Comandos útiles y de diagnóstico (lectura, sin riesgo)

```bash
# Ver qué hay corriendo
systemctl list-units --type=service --state=running
pm2 list                         # apps PM2 (todas — gestionadas por root)
ss -tlnp                         # puertos en uso

# Ver logs
tail -f /var/log/nginx/access.log
journalctl -u nginx -f
pm2 logs crm-iseih-api           # logs SOLO de nuestra app (no usar `pm2 logs` a secas)

# Ver config nginx completa
nginx -T
```

---

## 7. Resumen ejecutivo — operando como root

Como `root` se puede hacer **todo**. La lista de abajo no es una restricción técnica sino una disciplina operativa: hay 8 sitios y 3 apps Node en producción que **no son nuestras**.

### Permitido / esperado
| Acción | |
|---|---|
| Instalar paquetes (postgresql, redis, etc.) con `apt install` | ✅ |
| Crear directorios en `/opt/crm-iseih`, `/var/www/crm-iseih` | ✅ |
| Añadir nuevo sitio en `/etc/nginx/sites-available/` | ✅ |
| Añadir apps al `pm2-root.service` con nombre explícito `crm-iseih-*` | ✅ |
| Crear DB y usuario nuevos en MariaDB o PostgreSQL | ✅ |
| Usar puertos 3005, 3006, 3007 | ✅ |
| Configurar SSL con certbot para nuestros subdominios | ✅ |

### Prohibido (aunque root pueda hacerlo)
| Acción | |
|---|---|
| `pm2 restart all` / `pm2 delete all` / `pm2 kill` | ❌ — afecta a TODAS las apps (`prerender-opynio`, `psicologo-ia-pro`, `veterinary-ai`) |
| Detener/modificar las 3 apps PM2 ajenas | ❌ |
| Modificar configs nginx de los otros sitios | ❌ |
| Tocar `/var/www/.env` o cualquier `.env` ajeno | ❌ |
| Cambiar reglas de UFW para abrir puertos al exterior | ❌ |
| Detener `mariadb`, `nginx`, `php8.1-fpm` | ❌ |
| Borrar archivos en `/var/www/*` excepto los nuestros | ❌ |

---

## 8. Contactos y trazabilidad

- VPS proveedor: Hostinger (KVM)
- Auditoría inicial del estado del servidor: 2026-05-05 21:40 UTC

Cualquier cambio del equipo del CRM debe quedar bajo `/opt/crm-iseih/` o `/var/www/crm-iseih/` y **no debe modificar nada del listado en sección 3**.
