# Fase 1 - Core CRM

## Epics y Stories (Jira)

### Epic 1: Setup Infraestructura (CRM-1)
| Jira | Story | Estado |
|------|-------|--------|
| CRM-25 | F1-001 Instalar Node.js, PostgreSQL 16, PM2 | To Do |
| CRM-26 | F1-002 Configurar Nginx: /crm + /crm/api + HTTPS | To Do |
| CRM-27 | F1-003 PM2 ecosystem.config.js + arranque automatico | To Do |
| CRM-28 | F1-004 Configurar Cloudflare R2: bucket privado + SDK | To Do |
| CRM-29 | F1-005 Configurar Brevo: dominio + 4 templates email | To Do |
| CRM-30 | F1-006 Inicializar repo Git + estructura carpetas | To Do |
| CRM-31 | F1-007 Ejecutar migracion SQL inicial + seed data | To Do |
| CRM-32 | F1-008 Script backup pg_dump diario a R2 + cron | To Do |

### Epic 2: Auth + Roles + Panel Usuarios (CRM-2)
| Jira | Story | Estado |
|------|-------|--------|
| CRM-33 | F1-009 Schema DB: users, projects, user_projects | To Do |
| CRM-34 | F1-010 Endpoints auth: login, logout, refresh | To Do |
| CRM-35 | F1-011 JWT access 15min + refresh 30d httpOnly | To Do |
| CRM-36 | F1-012 Middleware roleGuard + projectAccess | To Do |
| CRM-37 | F1-013 CRUD usuarios + email bienvenida Brevo | To Do |
| CRM-38 | F1-014 Endpoint set-password con token unico | To Do |
| CRM-39 | F1-015 Tabla user_activity_log + registro automatico | To Do |
| CRM-40 | F1-016 Frontend: pantalla login | DONE |
| CRM-41 | F1-017 Frontend: AuthContext + ProjectSelector | DONE |
| CRM-42 | F1-018 Frontend: panel admin usuarios | DONE |
| CRM-43 | F1-019 Frontend: pantalla set-password | DONE |

### Epic 3: Productos + Dossiers PDF (CRM-3)
| Jira | Story | Estado |
|------|-------|--------|
| CRM-44 | F1-020 Schema DB: products, dossiers | To Do |
| CRM-45 | F1-021 CRUD productos por proyecto | To Do |
| CRM-46 | F1-022 Upload PDF a R2 con uuid+timestamp | To Do |
| CRM-47 | F1-023 Endpoint pre-signed URL (15min) | To Do |
| CRM-48 | F1-024 Historial versiones dossier | To Do |
| CRM-49 | F1-025 Frontend: panel gestion productos | DONE |
| CRM-50 | F1-026 Frontend: upload dossier drag&drop | DONE |

### Epic 4: Webhook + UTMs + Round-robin (CRM-4)
| Jira | Story | Estado |
|------|-------|--------|
| CRM-51 | F1-027 Schema DB: leads, lead_utms, project_queue_state | To Do |
| CRM-52 | F1-028 Endpoint POST /webhooks/leads/:slug + API key | To Do |
| CRM-53 | F1-029 Parseo UTMs + deteccion canal automatica | To Do |
| CRM-54 | F1-030 Deteccion duplicados por email + vinculacion | To Do |
| CRM-55 | F1-031 Round-robin transaccional PostgreSQL | To Do |
| CRM-56 | F1-032 Notificacion Brevo asincrona al gestor | To Do |
| CRM-57 | F1-033 CORS configurado por dominio de proyecto | To Do |
| CRM-58 | F1-034 Indices PostgreSQL optimizados para leads | To Do |
| CRM-59 | F1-035 Frontend: lista leads con filtros | DONE |
| CRM-60 | F1-036 Frontend: vista pipeline por status | DONE |
| CRM-61 | F1-037 Frontend: badge duplicados + alerta inactividad | DONE |

### Epic 5: Ficha Lead + Historial + Seguimiento (CRM-5)
| Jira | Story | Estado |
|------|-------|--------|
| CRM-62 | F1-038 Schema DB: lead_status_history, interactions, reminders | To Do |
| CRM-63 | F1-039 PATCH /leads/:id/status con historial | To Do |
| CRM-64 | F1-040 POST /leads/:id/interactions | To Do |
| CRM-65 | F1-041 POST /leads/:id/reminders + cron diario | To Do |
| CRM-66 | F1-042 Reasignacion manual lead (Admin/SA) | To Do |
| CRM-67 | F1-043 Frontend: ficha lead completa | DONE |
| CRM-68 | F1-044 Frontend: selector status con confirmacion | DONE |
| CRM-69 | F1-045 Frontend: timeline interacciones | DONE |
| CRM-70 | F1-046 Frontend: boton dossier + checkbox enviado | DONE |

### Epic 6: Conversiones y Pagos (CRM-6)
| Jira | Story | Estado |
|------|-------|--------|
| CRM-73 | F1-049 Schema DB: conversions, conversion_payments | To Do |
| CRM-74 | F1-050 Registrar conversion (auto cambia status) | To Do |
| CRM-75 | F1-051 Agregar abono parcial + recalculo pendiente | To Do |
| CRM-76 | F1-052 Cron pagos vencidos + notificacion email | To Do |
| CRM-77 | F1-053 Frontend: formulario conversion | DONE |
| CRM-78 | F1-054 Frontend: dashboard pagos pendientes | DONE |
| CRM-79 | F1-055 Frontend: vista ingresos por proyecto | DONE |

### Epic 7: Dashboard + QA Integral (CRM-7)
| Jira | Story | Estado |
|------|-------|--------|
| CRM-80 | F1-056 Backend: queries dashboard leads | To Do |
| CRM-81 | F1-057 Backend: queries dashboard ingresos | To Do |
| CRM-82 | F1-058 Indices + EXPLAIN ANALYZE top 5 queries | To Do |
| CRM-83 | F1-059 Frontend: dashboard leads con graficas | DONE |
| CRM-84 | F1-060 Frontend: dashboard ingresos filtrable | DONE |
| CRM-85 | F1-061 QA: flujo E2E completo | To Do |
| CRM-86 | F1-062 QA: multi-usuario 3 proy + 4 gestores | To Do |
| CRM-87 | F1-063 QA: test carga 50 webhooks | To Do |
| CRM-88 | F1-064 QA: revision seguridad endpoints | To Do |
| CRM-89 | F1-065 QA: verificacion responsive | To Do |
