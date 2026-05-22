# CRM-ISEIE

CRM nuevo para iseie/ISEIE. Construcción desde cero, hermano del CRM existente en [360crm.tech](https://360crm.tech/crm/).

## Estado

🟡 **En planificación.** El repositorio contiene solo la documentación heredada del intento anterior. Sin código todavía.

## Documentación

- **[CLAUDE.md](CLAUDE.md)** — guía de desarrollo para cualquier sesión de Claude
- **[documentacion/README.md](documentacion/README.md)** — índice de flujos y arquitectura (Mermaid)
- **[vps-72.60.90.135-handoff.md](vps-72.60.90.135-handoff.md)** — handoff del servidor compartido **(lectura obligatoria antes de deploy)**
- **[PLAN-TRABAJO.md](PLAN-TRABAJO.md)** — plan heredado (referencia, no roadmap actual)
- **[BACKEND-PENDIENTE.md](BACKEND-PENDIENTE.md)** — checklist de endpoints/módulos
- **[MANUAL-USUARIO.md](MANUAL-USUARIO.md)** — manual end-user (scope de funcionalidad)

## Stack previsto

React 18 + Vite + Tailwind · Node.js + Express · PostgreSQL · PM2 · Nginx · Cloudflare R2 · Brevo.

Mismo que el CRM existente. Confirmar con el usuario antes de divergir.

## Repo hermano (referencia de patrones)

[`esos2dev-oss/CRM`](https://github.com/esos2dev-oss/CRM) — CRM en producción. Es la **fuente de verdad** para arquitectura, convenciones y patrones. Antes de inventar, revisar cómo está resuelto allí.

## Despliegue (resumen)

| | |
|---|---|
| VPS | `72.60.90.135` (compartido con otras apps) |
| Usuario | `root` |
| Puertos reservados | 3005, 3006, 3007 |
| Backend | `/opt/crm-iseie/` |
| Frontend | `/var/www/crm-iseie/` |
| PM2 | `pm2-root.service` (compartido con otras apps del VPS) |

Detalles, reglas y comandos en [vps-72.60.90.135-handoff.md](vps-72.60.90.135-handoff.md).
