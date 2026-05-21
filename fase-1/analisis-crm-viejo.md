# Analisis CRM Viejo (prototipo) vs CRM Nuevo

## Lo que es el CRM viejo

**Nombre:** CRM Inteligente (ISEIE Innovation School)
**Autores:** Diego Landaeta, Abraham Rodriguez, Ronald Quijano (Universitario, junio 2025)
**Stack:**
- Frontend: React 19 + TypeScript + Vite
- Backend: **Supabase** (PostgreSQL + Auth + Storage)
- IA: Google Gemini API (asistente "Cermi")
- Graficas: Chart.js / react-chartjs-2
- Excel: xlsx
- Emails: n8n workflow JSON (automatizacion externa)
- WordPress: landing de acceso
- **NO hay backend Node/Express propio** - todo via Supabase

## Modelo de datos (schema Supabase)

### profiles (usuarios)
```sql
id UUID (FK auth.users)
full_name, email
role: platform_admin | crm_admin | crm_collaborator
crm_id UUID  -- cada usuario pertenece a UN CRM
```

### clients (clientes - conversiones)
```sql
id, crm_id, owner_id, assignee_id
estimated_value DECIMAL
last_contact, creation_date, next_contact
name, email, phone
program (producto/curso)
stage (status pipeline)
owner, coordinator (texto, no FK)
notes, country, origin
-- Pagos:
payment_type (single | installments)
installments_total, installments_paid
installment_details JSON  -- array con detalles de cada cuota
total_paid
single_payment_method
```

### prospects (leads antes de convertir)
```sql
-- campos similares a clients pero sin datos de pago
id, crm_id, creation_date
estimated_value, last_contact, next_contact
name, email, phone, program, stage
owner, coordinator, notes, country, origin
owner_id
```

### Otras tablas
- `invitations` - gestion de invitaciones
- `app_config` - config por CRM (country, currency, team role label plural/singular, quick create options, academic offer)
- `email_logs` - historial envios
- `rate_limit_logs` - rate limiting
- `roles` + `permissions` + `role_permissions` - sistema granular (mas adelante se colapso a los 3 roles fijos)

## Paginas del CRM viejo

| Pagina | Que hace |
|--------|----------|
| **Dashboard** | KPIs (leads/mes, revenue), top paises, top coordinadores, actividad reciente |
| **Clients** | Tabla con filtros + CRUD + paginacion |
| **Prospects** | Tabla + pipeline stages |
| **AddClient / EditClient** | Form completo |
| **AddProspect / EditProspect** | Form mas simple |
| **ConvertProspect** | Convertir prospect en client |
| **Email** | Campanas email (n8n) |
| **Calendar** | Calendario con citas/recordatorios |
| **Billing** | Facturacion y cuotas |
| **Statistics** | Graficas varias con modal de seleccion |
| **Configuration** | Config general, academic offer, quick create, team permissions |
| **Coordinators** | Gestion de coordinadores |
| **Roles** | Roles y permisos |
| **Support** | Soporte tecnico |
| **Manual** | Manual de usuario |
| **NotificationsPage** | Notificaciones in-app |
| **CermiChat** (floating) | Asistente IA con Gemini + contexto CRM |

## Features que tienen y NOSOTROS NO

| Feature | Utilidad para nuestro CRM |
|---------|---------------------------|
| **Modal "Quick Create"** | Crear lead/prospect rapido desde cualquier pagina |
| **Calendario con citas** | Visualizar reminders + appointments en vista calendario |
| **Billing / cuotas con detalle JSON** | Nuestro `installment_details` es simple, ellos guardan array detallado |
| **Import CSV modal** | Importar leads masivo desde Excel |
| **Pagination controls reutilizable** | Componente para toda la app |
| **ScrollableTableContainer** | Wrapper para tablas con scroll horizontal |
| **GraphSelectionModal** | Usuario elige que grafica ver |
| **CermiChat (Gemini)** | Asistente IA flotante - ellos lo tienen ya montado, nosotros pensamos hacerlo en Fase 3 con Claude |
| **Notifications in-app con badge** | Campana en header con novedades + seguimientos pendientes |
| **NovedadesModal** | Mostrar "que hay nuevo" en cada version |
| **CreatorsModal** | Modal con creditos del equipo |
| **DuplicateContactModal** | Modal especifico para gestionar duplicados |
| **InstallmentModal** | Gestionar cuotas de pago |
| **Manual de usuario** como pagina | Onboarding integrado |
| **Support** como pagina | Contacto soporte desde el CRM |
| **Roles con permisos granulares** (tabla role_permissions) | Mas flexible que solo 3 roles fijos |
| **FormCombobox component** | Combobox con autocomplete |
| **FilterPanel reutilizable** | Panel de filtros consistente |
| **Archivado de contactos** | Soft delete con opcion de recuperar |
| **n8n workflow JSON** | Automatizacion email sin codigo |
| **app_config.team_role_label_plural/singular** | Customizable por CRM ("coordinadora" vs "gestor") |

## Features que NOSOTROS tenemos y ellos NO

| Feature | Por que somos mejores |
|---------|----------------------|
| **Webhook publico por API key** | Ellos crean leads manual, nosotros via formulario landing |
| **Round-robin automatico** | Distribuye carga entre gestores |
| **UTMs + deteccion canal automatica** | Trazabilidad marketing |
| **Multi-proyecto real** (Psiko, ISEIH, Fono, IAs) | Ellos son "multi-crm" pero cada user pertenece a UNO |
| **Backend Node/Express propio** | Mas control vs Supabase |
| **JWT + refresh rotation propio** | No dependencia Supabase Auth |
| **Tests automatizados (73)** | Ellos no tienen tests visibles |
| **Migraciones SQL versionadas** | Control de schema |
| **Integracion Meta/Google/GSC** (Fase 2) | Ellos no integran ads platforms |
| **Dossiers PDF versionados en R2** | Ellos no tienen dossiers |

## Diferencias conceptuales clave

### 1. Modelo de datos
- **Ellos:** separan `clients` (convertidos) de `prospects` (no convertidos). **DUPLICACION** - mismos campos en 2 tablas
- **Nosotros:** una sola tabla `leads` con `status` (nuevo -> convertido). Mas normalizado y flexible

### 2. Multi-tenant
- **Ellos:** `crm_id` en cada tabla - cada cliente es un "CRM" aislado. Usuario pertenece a UN crm_id
- **Nosotros:** `project_id` - usuario puede pertenecer a VARIOS proyectos con roles por proyecto

### 3. Roles
- **Ellos:** tabla `role_permissions` flexible, pero en practica colapso a 3 roles (platform_admin, crm_admin, crm_collaborator)
- **Nosotros:** 3 roles fijos (superadmin, admin, gestor). Mas simple pero menos flexible

### 4. IA
- **Ellos:** Gemini con contexto JSON del CRM inyectado en el prompt
- **Nosotros:** planeado Claude (Fase 3) con context builder dedicado

### 5. Pagos
- **Ellos:** `installment_details` como JSON dentro de clients - rapido pero no relacional
- **Nosotros:** tabla `conversion_payments` separada - mas queryable

## Ideas aprovechables para nuestro CRM

### Urgentes (valor alto / esfuerzo bajo)
1. **Modal Quick Create** - crear lead rapido desde navbar (icono +)
2. **Notificaciones in-app** con campana en header + tabla `notifications`
3. **Pagination controls reutilizable** - ya tenemos algo pero mejorable
4. **FilterPanel reutilizable** - filtros en Leads/Conversions/Dashboard
5. **Calendario con reminders** - pagina /calendar con vista semanal/mensual
6. **Import CSV modal** - subir leads masivo (admin only)

### Medio plazo (valor medio)
7. **Manual + Support** como paginas integradas
8. **NovedadesModal** - cambios version por version
9. **DuplicateContactModal** - merge de duplicados
10. **GraphSelectionModal** - user elige que grafica ver
11. **FormCombobox** - autocomplete en selects largos (proyectos, productos)

### Largo plazo
12. **Permisos granulares** (tabla role_permissions) para cuando 3 roles no basten
13. **Archivado suave** con papelera de reciclaje
14. **n8n workflows** para emails sin hardcodear

## Cosas que NO deberiamos copiar

- **Separar clients/prospects** - mantener `leads` unificado es mejor diseño
- **Supabase como backend** - ya tenemos Node/Express con mas control
- **TypeScript** - CLAUDE.md dice JavaScript explicitamente
- **`crm_id` en cada tabla** - nuestro `project_id` ya lo hace mejor
- **Gemini API** - usaremos Claude (Fase 3)

## Conclusion

El CRM viejo es un prototipo universitario bien logrado pero limitado:
- Buen diseño de UX (muchos modales, pagination, filtros reutilizables)
- Multi-tenant simple (1 user = 1 CRM)
- IA integrada desde el inicio (Cermi con Gemini)

Nuestro CRM nuevo es mas robusto a nivel arquitectura:
- Webhooks reales, round-robin, UTMs, integraciones ad platforms
- Multi-proyecto real con permisos finos
- Tests, migraciones, stack mas profesional

**Lo aprovechable son los patrones de UI/UX y algunas features menores que nos faltan**, no la arquitectura.
