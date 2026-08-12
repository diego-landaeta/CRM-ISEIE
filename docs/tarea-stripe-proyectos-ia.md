# Tarea para Ángel · Stripe en los proyectos IA

## Qué hay que conseguir

Que los **proyectos IA** (Psicólogo IA, Nutricionista IA, Tarot IA y los que
vengan) cobren por Stripe dentro del CRM, y que **empiecen a facturar desde el
día que se dan de alta en el CRM, nunca desde antes**.

Lo de antes ya se facturó fuera. Si reaparece, se factura dos veces.

## Por qué importa, con números

Hoy hay **576 cobros de Stripe anteriores al alta de su proyecto**:

| Proyecto | Entró al CRM | Cobros anteriores | El primero |
|---|---|---|---|
| Psiko Aprende | 12/05/2026 | **514** | 10/01/2025 |
| ISEIH | 11/05/2026 | 31 | 09/12/2025 |
| ACADEMIA IA | 10/06/2026 | 15 | 13/02/2026 |
| ICTESS | 15/05/2026 | 12 | 09/02/2026 |
| Fono Aprende | 12/05/2026 | 4 | 26/11/2025 |

Esos no se cuelan hoy porque alguien puso a mano un corte en cada proyecto. Un
proyecto nuevo **no tiene ese corte**, y ahí es donde se cuela el histórico
entero.

## Lo que ya está hecho — no lo rehagas

En `backend/src/modules/stripe-payments/stripe-payments.model.js` el suelo de
facturación tiene ahora tres escalones, por orden:

1. `invoicing_status.al_dia_hasta` — el corte puesto a mano. Manda sobre todo.
2. La fecha de la primera factura de la sociedad emisora del proyecto.
3. **`projects.created_at`** — el día que el proyecto entró al CRM. ← nuevo

Antes, cuando no había ninguno de los dos primeros, el suelo era **1900**.

Comprobado contra producción: **no cambia ni un cobro de los proyectos de hoy**
—41 candidatos antes, 41 después—, porque todos resuelven por el escalón 1 o el
2. El escalón 3 solo actúa en proyectos nuevos, que es justo el caso de los IA.

## Lo que hay que hacer

### 1 · Dar de alta los proyectos IA

Hoy en producción hay 9 proyectos y **ninguno es IA**. Hay que crearlos con:

- Nombre y `type` correcto (mirar el enum de `projects.type`; los 9 de hoy son
  `crm`, y hay pantallas que se activan solo con `type = 'ia'`).
- **Sociedad emisora**: de ahí salen los datos fiscales de la factura.
- Su serie de facturación, si va a emitir facturas.

### 2 · La clave de Stripe de cada uno

Va en `project_integrations` (proveedor `stripe`), **cifrada**, no en el `.env`.
Se guarda desde el panel: *Finanzas → Integraciones*. `getStripeKey(projectId)`
la lee de ahí y solo cae a `process.env.STRIPE_SECRET_KEY` si no encuentra nada.

**Una clave por proyecto.** Si dos proyectos comparten cuenta de Stripe, los
cobros de uno aparecen en el otro y no hay forma de separarlos después.

### 3 · El secreto del webhook — esto no es opcional

**Ninguno de los 6 proyectos con Stripe tiene `webhook_secret` puesto.** Y el
webhook, cuando no hay secreto, **acepta el evento sin comprobar la firma**
(`stripe-payments.controller.js`). O sea: hoy quien conozca la URL puede
inventarse un cobro y el CRM se lo cree.

Al conectar cada proyecto IA hay que poner también su `webhook_secret` —el
`whsec_…` que da Stripe al crear el endpoint—. Ponérselo a los 6 que ya están
puede ir en otra tarea, pero hay que hacerlo.

### 4 · Comprobar el corte ANTES de encender nada

Con el proyecto creado y la clave puesta, antes de la primera sincronización:

```sql
-- Tiene que salir la fecha de alta del proyecto. Ni 1900, ni una fecha vieja.
SELECT p.id, p.nombre, p.created_at::date AS alta,
       (SELECT al_dia_hasta FROM invoicing_status s WHERE s.project_id = p.id) AS corte_mano,
       (SELECT MIN(fecha_emision) FROM invoices f
         WHERE f.issuer_id = p.sociedad_emisora_id
           AND f.tipo <> 'proforma' AND f.numero IS NOT NULL) AS primera_factura
  FROM projects p ORDER BY p.id;
```

Después de sincronizar, la pantalla *Finanzas → Pagos Stripe* con el filtro de
facturables **no debe traer nada anterior al alta**. Si trae algo, para y avisa
antes de asociar nada: cada asociación crea una factura.

## Cómo trabajar

- Rama `feat/stripe-ia` desde `staging`. Pull request **a `staging`**, nunca a
  `main`.
- **Todo en local.** `docker-compose.dev.yml` levanta la base de pruebas y
  `npm run db:preparar` la deja lista. No hace falta entrar en ningún servidor.
- **Nada de ejecutar SQL en producción.** Si hace falta un cambio de esquema, va
  en un fichero nuevo en `backend/migrations/` y lo aplica Diego.
- Claves de Stripe **en modo test** para desarrollar. Las de producción las pone
  Diego desde el panel; no viajan por chat ni entran en el repositorio.

## Cuándo está terminado

- [ ] Los proyectos IA existen, con su sociedad emisora.
- [ ] Cada uno con su clave de Stripe cifrada en `project_integrations`.
- [ ] Cada uno con su `webhook_secret`, y un evento sin firma **se rechaza**.
- [ ] Tras sincronizar, no aparece **ningún** cobro anterior a la fecha de alta.
- [ ] Un cobro nuevo de prueba sí aparece y se puede asociar a una venta.
- [ ] Tests en `backend/tests/` que cubran los tres escalones del suelo.
