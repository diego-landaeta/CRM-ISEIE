# Handoff Angel — Sprint 2 Frontend

Tickets asignados y cómo conectar cada uno al backend existente.

---

## CRM-229 — Settings > Roles y Permisos (depende de CRM-228, Diego)

### Espera a que Diego mergee CRM-228 antes de empezar esta parte.

### Qué hace el backend nuevo
- `GET /api/permissions/system-defaults` → objeto con permisos de los 4 roles fijos
- `GET /api/custom-roles` → array de roles custom creados
- `POST /api/custom-roles` → `{ label, description, base_role, permissions: {} }`
- `PUT /api/custom-roles/:id`
- `DELETE /api/custom-roles/:id`
- `GET /api/users/:id/permissions` → permisos efectivos (rol + overrides combinados)
- `PUT /api/users/:id/permissions` → `[{ resource, action, allowed }, ...]`

### El `/auth/me` ahora devuelve
```json
{
  "user": {
    "id": 5,
    "role": "gestor",
    "custom_role_id": null,
    "custom_role_label": null
  },
  "permissions": {
    "leads.view": true,
    "leads.delete": false,
    "leads.export": false,
    ...
  }
}
```

### Archivos a crear
```
frontend/src/shared/hooks/usePermission.js
frontend/src/modules/permissions/api/permissions.api.js
frontend/src/modules/permissions/pages/RolesPage.jsx
```

### Hook usePermission
```js
// frontend/src/shared/hooks/usePermission.js
import { useAuth } from '@/shared/hooks/useAuth';

export function usePermission(resource, action) {
  const { user } = useAuth();
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  return user.permissions?.[`${resource}.${action}`] ?? false;
}
```

### Layout RolesPage
- Panel izquierdo: lista roles. Badge gris "Sistema" para los 4 fijos. Badge azul "Custom" para los creados. Botón "+ Crear rol".
- Panel derecho: tabla de permisos por recurso/acción (checkboxes)
  - Roles fijos: checkboxes **disabled** (solo lectura)
  - Roles custom: checkboxes editables + botón "Guardar"

### Recursos y acciones disponibles
```js
export const RESOURCES = {
  leads:           ['view', 'create', 'edit', 'delete', 'export', 'assign', 'bulk_action'],
  conversions:     ['view', 'create', 'edit', 'delete'],
  products:        ['view', 'create', 'edit', 'delete'],
  clients:         ['view', 'create', 'edit', 'delete', 'export'],
  dossiers:        ['view', 'upload', 'delete'],
  commissions:     ['view', 'create', 'edit', 'delete'],
  matriculas:      ['view', 'create', 'edit', 'delete'],
  accounting:      ['view', 'create', 'edit', 'delete'],
  accounts_payable:['view', 'create', 'edit', 'delete'],
  payroll:         ['view', 'create', 'edit', 'delete'],
  reports:         ['view', 'export'],
  ia:              ['view'],
  woocommerce:     ['view', 'sync'],
  webhooks:        ['view', 'create', 'edit', 'delete'],
  forms:           ['view', 'create', 'edit', 'delete'],
  email_sequences: ['view', 'create', 'edit', 'delete'],
  users:           ['view', 'create', 'edit', 'delete'],
  settings:        ['view', 'edit'],
  field_defs:      ['view', 'edit'],
  channels:        ['view', 'edit'],
};
```

### Editar usuario — sección permisos
En la página Users > editar:
- Dropdown de rol: incluir los 4 fijos + roles custom del GET /api/custom-roles
- Sección "Excepciones personales" con lista de overrides + botón añadir

### Aplicar usePermission en páginas existentes
```jsx
// LeadsPage.jsx
const canDelete = usePermission('leads', 'delete');
const canExport = usePermission('leads', 'export');
const canBulk   = usePermission('leads', 'bulk_action');

{canExport && <Button onClick={exportCsv}>Exportar</Button>}
{canDelete && <Button variant="destructive">Eliminar</Button>}
```
Aplicar también en: ConversionsPage, ProductsPage, ClientsPage

---

## CRM-230 — Webhooks sección propia

### Backend ya funciona, solo filtrar por kind
```js
// webhooks.api.js
GET /api/forms?projectId=X&kind=webhook   // ← añadir &kind=webhook
POST /api/forms { ..., kind: 'webhook' }
```

### Archivos a crear
```
frontend/src/modules/webhooks/pages/WebhooksPage.jsx
frontend/src/modules/webhooks/pages/WebhookDetailPage.jsx
frontend/src/modules/webhooks/components/WebhookCard.jsx
frontend/src/modules/webhooks/components/PayloadMapper.jsx
frontend/src/modules/webhooks/components/ListenModePanel.jsx
```

### Ruta en App.jsx
```jsx
const WebhooksPage = lazy(() => import('./modules/webhooks/pages/WebhooksPage'));
// <Route path="/webhooks" element={<WebhooksPage />} />
// <Route path="/webhooks/:id" element={<WebhookDetailPage />} />
```

### Sidebar — entrada separada "Webhooks"
Diferente de "Formularios". Los webhooks NO muestran código embed — muestran la URL del endpoint:
```
https://crm.iseie.com/api/forms/receive/{whk_xxxx}
```
Botón copiar al portapapeles al lado de la URL.

### Listen mode
Ya existe en el backend:
```
POST /api/forms/:id/listen   ← activar escucha
GET  /api/forms/:id/listen   ← polling (¿llegó un payload?)
```
UI: botón "Capturar payload de prueba" → activa el listen → polling cada 2s → cuando llega muestra el JSON capturado → el usuario puede mapear campos.

### PayloadMapper
Tabla de dos columnas:
- Columna izquierda: keys del payload capturado (ej: "nombre", "telefono", "email")
- Columna derecha: selector del campo del lead al que mapear

---

## CRM-234 — UI Campos personalizados en Settings

### Backend completamente listo
```
GET    /api/field-definitions?projectId=X&entity=lead
POST   /api/field-definitions    { project_id, entity, name, label, field_type, options[], required, position }
PUT    /api/field-definitions/:id
DELETE /api/field-definitions/:id
POST   /api/field-definitions/reorder   { ids: [3,1,2] }
```

`entity` puede ser: `lead` | `client` | `product`
`field_type` puede ser: `text` | `number` | `date` | `select` | `boolean` | `textarea`

### Archivos a crear
```
frontend/src/modules/field-definitions/api/field-definitions.api.js
frontend/src/modules/field-definitions/hooks/useFieldDefinitions.js
frontend/src/modules/field-definitions/pages/FieldDefinitionsPage.jsx
frontend/src/modules/field-definitions/components/FieldDefinitionCard.jsx
frontend/src/modules/field-definitions/components/FieldDefinitionModal.jsx
frontend/src/shared/components/CustomFieldRenderer.jsx
```

### FieldDefinitionsPage layout
- 3 tabs: Prospectos | Clientes | Productos
- Cada tab: lista de campos del sistema (gris, no editables) + campos custom arrastrables
- Botón "+ Añadir campo" abre FieldDefinitionModal

### FieldDefinitionModal
```
Label:     [_______________]
Nombre:    [auto-slug_____] (editable)
Tipo:      [Texto ▾]
Opciones:  (solo si tipo=select) [+ Añadir opción]
Requerido: [toggle]
```

### Reordenar
Si dnd-kit está instalado usarlo, si no: flechas arriba/abajo. Al cambiar orden → `POST /api/field-definitions/reorder { ids: [nuevo orden] }`.

### CustomFieldRenderer — renderizar en formularios
```jsx
// Usar en el form de crear/editar lead
function CustomFieldRenderer({ field, value, onChange }) {
  switch (field.field_type) {
    case 'text':     return <Input value={value} onChange={onChange} />;
    case 'number':   return <Input type="number" value={value} onChange={onChange} />;
    case 'date':     return <Input type="date" value={value} onChange={onChange} />;
    case 'boolean':  return <Switch checked={value} onCheckedChange={onChange} />;
    case 'textarea': return <Textarea value={value} onChange={onChange} />;
    case 'select':   return <Select value={value} onValueChange={onChange}>
                              {field.options.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                            </Select>;
  }
}
```
Al guardar el lead: `custom_fields: { [field.name]: value }` en el body del POST/PUT.

---

## Prioridad sugerida

1. **CRM-234** — Campos personalizados (backend listo, impacto visual alto)
2. **CRM-230** — Webhooks sección propia (solo UI, backend listo)
3. **CRM-229** — Roles (esperar merge de Diego primero)

---

## Preguntas frecuentes

**¿Cómo sé si dnd-kit está instalado?**
`cat frontend/package.json | grep dnd-kit` — si no aparece, usar flechas arriba/abajo para reordenar.

**¿El endpoint de field-definitions requiere auth?**
Sí, todas las rutas del CRM requieren `verifyToken`. El axios client ya envía el token automáticamente.

**¿Cómo accedo al projectId activo?**
```js
const { activeProject } = useProject();
// activeProject.id
```
