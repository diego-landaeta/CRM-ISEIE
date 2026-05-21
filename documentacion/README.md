# Documentación — CRM-ISEIE

Flujos, arquitectura y planning. Diagramas en Mermaid (se renderizan en GitHub).

## Índice

### Baseline obligatorio (empezar aquí)
- **[00 — Baseline desde el CRM existente](00-baseline-desde-crm.md)** — catálogo canónico de los 32 módulos backend + 34 frontend del CRM hermano. **Todo lo que se cree en CRM-ISEIE deriva de aquí.**

### Plan heredado (referencia histórica, no roadmap actual)
- [Plan Camino B](00-plan-camino-b.md) — roadmap del intento anterior

### Arquitectura
1. [Arquitectura general del sistema](01-arquitectura-general.md) - Servidor, DB, frontend, APIs externas
2. [Entornos: production vs staging](02-entornos.md) - Nginx, PM2, DBs
3. [Modelo entidad-relacion (ERD)](03-modelo-datos.md) - Todas las tablas y relaciones

### Flujos de usuario
4. [Autenticacion](04-flujo-autenticacion.md) - Login, refresh, logout, set-password
5. [Roles y permisos](05-roles-permisos.md) - Matriz quien ve/hace que
6. [Multi-proyecto (equipos)](06-multiproyecto.md) - Como se asignan usuarios a proyectos

### Flujos de negocio
7. [Webhook de leads + Round-robin](07-flujo-webhook-leads.md) - Desde formulario web hasta gestor asignado
8. [Ciclo de vida del lead](08-ciclo-vida-lead.md) - Pipeline completo de status
9. [Conversion y pagos](09-flujo-conversion-pagos.md) - Registrar venta + abonos parciales
10. [Duplicados y reincidentes](10-flujo-duplicados.md) - Como se detectan y gestionan
11. [Interacciones y recordatorios](11-flujo-interacciones.md) - Llamadas, emails, whatsapp, reminders
12. [Dossiers (PDFs)](12-flujo-dossiers.md) - Upload R2, versionado, envio

### Funcionalidades nuevas (Camino B - portadas del CRM viejo)
13. [Notificaciones in-app](13-flujo-notificaciones.md) - Campana en navbar + badge
14. [Quick Create](14-flujo-quick-create.md) - Modal rapido para crear leads
15. [Import CSV](15-flujo-import-csv.md) - Carga masiva de leads
16. [Calendario](16-flujo-calendario.md) - Vista mensual/semanal de reminders

### Integraciones (Fase 2)
17. [Meta Ads API](17-flujo-meta-ads.md) - Vincular campanas con leads
18. [Google Ads + GSC](18-flujo-google.md) - Ads + Search Console
19. [Stripe (proyectos IA)](19-flujo-stripe.md) - MRR, churn, suscripciones
20. [Reportes Claude AI](20-flujo-reportes-ia.md) - Generacion mensual + chat

### DevOps
21. [Deploy al servidor](21-flujo-deploy.md) - Tarball scp + PM2 restart
22. [Backups](22-flujo-backups.md) - pg_dump diario a R2

## Como leer los diagramas

Los diagramas Mermaid se renderizan automaticamente en:
- GitHub (en el .md)
- VS Code con extension "Markdown Preview Mermaid Support"
- mermaid.live (copy/paste)

Colores:
- **Verde**: operacion OK
- **Naranja**: advertencia o decision
- **Rojo**: error o camino fallido
- **Azul**: entrada/salida de datos
