# Setup Servidor VPS - Documentacion

> **Jira:** CRM-25, CRM-26, CRM-27
> **Fase:** 1.1 - Setup Infraestructura
> **Fecha:** 2026-04-06

---

## 1. Datos del Servidor

| Campo | Valor |
|-------|-------|
| **Proveedor** | Hostinger VPS (KVM) |
| **OS** | Ubuntu 25.04 (Plucky Puffin) |
| **Kernel** | 6.14.0-37-generic x86_64 |
| **Hostname** | srv1548138 |
| **IP** | Ver repo privado (.env.server) |
| **Puerto SSH** | 22 |

## 2. Usuarios Creados

| Usuario | Proposito | Acceso SSH | Sudo |
|---------|-----------|------------|------|
| `root` | Administracion | Key-based | Si |
| `claude` | Deploy y operaciones CRM | Key-based | Si (NOPASSWD) |

## 3. Seguridad SSH Aplicada

- Acceso por clave SSH ED25519 (no password)
- Clave publica copiada desde maquina de desarrollo (Diego@LAPTOP-HPPO8T3H)
- Sudoers configurado en `/etc/sudoers.d/claude`

## 4. Estructura de Repositorios

```
CRM (repo publico - github.com/esos2dev-oss/CRM)
  Todo el codigo fuente, docs, configs (sin datos sensibles)
  .env.example con variables sin valores reales

CRM-private (repo privado - por crear)
  .env.server        → IP, passwords, SSH config
  .env.production     → Variables de entorno produccion
  .env.staging        → Variables de entorno staging
  credentials/        → API keys, tokens, certificados
```

## 5. Estado de Stories

- [x] Node.js v24.14.1 LTS via nvm (CRM-25) ✓ DONE
- [x] PostgreSQL 17.7 UTF-8 (CRM-25) ✓ DONE (PG17 por compatibilidad Ubuntu 25.04)
- [x] PM2 6.0.14 global + startup systemd (CRM-25, CRM-27) ✓ DONE
- [x] DB crm_db + usuario crm_user + acceso remoto (CRM-33) ✓ DONE
- [ ] Configurar Nginx: /crm + /crm/api + HTTPS (CRM-26) — IN PROGRESS
- [ ] Configurar Cloudflare R2 (CRM-28)
- [ ] Configurar Brevo (CRM-29)
