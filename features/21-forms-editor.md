# Editor de formularios de contacto por proyecto

**Jira:** CRM-175
**Estado:** 📝 Backlog
**Tipo:** Feature

## Contexto

Los landings de Psiko, ISEIH y Fono tienen formularios en WordPress que envian leads a un webhook del CRM. Queremos que el propio admin pueda crear formularios desde el CRM, copiar un snippet, y pegarlo en cualquier landing. El CRM gestiona los submits, UTMs, validacion y lista de productos.

## Enfoque: plantillas, NO builder drag-drop

Para evitar complejidad, el usuario elige entre 2 plantillas pre-hechas, les pone nombre, activa toggles opcionales y listo.

## Alcance

- [ ] 2 plantillas iniciales: **Contacto basico** (nombre, email, telefono, mensaje) y **Lead con producto** (+ select de producto)
- [ ] Toggles: telefono opcional, campo "como nos conociste", checkbox politica privacidad
- [ ] Tras envio: mostrar "Gracias" o redirect URL
- [ ] Color primario override (opcional, default hereda del proyecto)
- [ ] 3 tipos de embed por form:
  1. `<script>` con auto-captura UTMs (document.location.search)
  2. `<iframe>` aislado
  3. Webhook JSON con ejemplos curl / Make / Zapier / Brevo
- [ ] JSON schema viewer (lo que llega al backend)
- [ ] Stats: submits ult 30d, ultimos leads, tasa exito
- [ ] **Shadow DOM** para aislar CSS del landing

## Config heredada del proyecto activo

- Logo en el header del form
- `producto_label` (ej "Formacion de interes" en vez de "Producto")
- Productos disponibles en el select (solo los del proyecto)
- Color primario por defecto

## Config propia del form

- Nombre ("Landing Psiko Home Oct")
- Plantilla
- Toggles
- Success message / redirect
- Color primario override
- `active` / inactive

## Modelo

```sql
CREATE TABLE forms (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id),
  slug VARCHAR(100) UNIQUE NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  template VARCHAR(50) NOT NULL CHECK (template IN ('contacto_basico','lead_con_producto')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  api_key VARCHAR(100) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE form_submissions (
  id SERIAL PRIMARY KEY,
  form_id INT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  ip VARCHAR(45),
  user_agent TEXT,
  lead_id INT REFERENCES leads(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Endpoints

| Metodo | Path | Descripcion |
|---|---|---|
| POST | `/api/forms/:slug/submit` | Submit desde form (publico con api_key en header) |
| GET | `/api/forms` | Lista forms del proyecto |
| POST | `/api/forms` | Crear form |
| PATCH | `/api/forms/:id` | Editar |
| DELETE | `/api/forms/:id` | Desactivar |
| POST | `/api/forms/:id/regenerate-key` | Rotar api_key |
| GET | `/embed.js` | Script publico que renderiza el form |

## UI

Pagina `/forms` filtrada por proyecto activo.

Detalle del form con 3 tabs:
1. **Embed snippet** — `<div data-crm-form="slug"></div>` + `<script src="...embed.js"></script>`
2. **JSON schema** — ejemplo del payload con curl / Make / Zapier / Brevo
3. **Stats / submits recientes**

## Snippet ejemplo

```html
<!-- Copiar y pegar en cualquier landing -->
<div data-crm-form="psiko-landing-home-oct"></div>
<script src="https://iseie.com/testeo_crm/embed.js"></script>
```

El script:
- Hace fetch del JSON config del form (`/api/forms/:slug/config`)
- Inyecta el HTML del form dentro del div con Shadow DOM
- Captura UTMs del URL al cargar
- Valida client-side
- POST al `/api/forms/:slug/submit` con el payload + UTMs
- Muestra "Gracias" o redirige

## JSON que llega al backend

```json
POST /api/forms/psiko-landing-home-oct/submit
X-Form-Key: fk_xyz9a3b_...

{
  "nombre": "Maria Lopez",
  "email": "maria@gmail.com",
  "telefono": "+34600000000",
  "producto_interes": "Master Neuroeducacion",
  "mensaje": "...",
  "como_nos_conociste": "google",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "neuro-oct",
  "landing_url": "https://psikoaprende.com/home?utm_source=google..."
}
```

## Diferencia vs webhook existente

- Hoy: **1 webhook por proyecto** (`/api/leads/webhooks/:slug`)
- Forms: **N forms por proyecto**, cada uno con su slug + key + stats separados
- Admin puede tener "Landing home" / "Popup BF" / "Landing master neuro" sin mezclarlos

## AC

- [ ] Admin crea form en menos de 30s (elige plantilla, toggles, guarda)
- [ ] Copia snippet y pega en un landing → form aparece renderizado con el logo del proyecto y los productos del select
- [ ] Envia submit de prueba → aparece como lead en el CRM con UTMs correctas
- [ ] Stats muestran el submit
- [ ] Regenerar api_key invalida el embed anterior
