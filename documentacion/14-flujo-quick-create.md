# 14. Quick Create (NUEVO - Camino B)

## Concepto

Boton `+` en el navbar que abre modal para crear rapidamente un lead desde cualquier pagina sin ir a /leads/new. Inspirado en el CRM viejo.

## UI

```mermaid
flowchart TD
    NAV[Navbar top]
    NAV --> BTN[Boton + Plus Phosphor]
    BTN --> OPEN[Click o Cmd/Ctrl+K]
    OPEN --> MODAL[Modal centrado 480px]
    MODAL --> TABS{Que crear?}
    TABS --> T1[Tab: Lead]
    TABS --> T2[Tab: Interaccion rapida]
    TABS --> T3[Tab: Reminder]

    T1 --> F1[Form minimo:<br/>- nombre*<br/>- email*<br/>- telefono<br/>- proyecto activo<br/>- producto interes<br/>- canal manual]

    T2 --> F2[Form:<br/>- lead (autocomplete)<br/>- tipo<br/>- nota]

    T3 --> F3[Form:<br/>- lead (autocomplete)<br/>- fecha<br/>- nota]

    F1 --> SUBMIT1[POST /api/leads<br/>manual: true<br/>canal: directo por default]
    F2 --> SUBMIT2[POST /api/leads/:id/interactions]
    F3 --> SUBMIT3[POST /api/leads/:id/reminders]

    SUBMIT1 --> CLOSE[Cierra modal + toast + navegar a detalle]
    SUBMIT2 --> CLOSE2[Cierra modal + toast]
    SUBMIT3 --> CLOSE2
```

## Por que es util

| Sin Quick Create | Con Quick Create |
|------------------|------------------|
| Ir a /leads > click "Nuevo" > rellenar form largo | Cmd+K > tab Lead > campos minimos > Enter |
| 4-5 clicks | 2 clicks + teclado |
| Form con todos los campos (abruma) | Solo 4 campos minimos |

## Backend necesario

Endpoint nuevo: `POST /api/leads` (crear lead manualmente sin webhook)

```js
// backend/src/modules/leads/lead.validation.js
export const createLeadManualSchema = z.object({
  project_id: z.number().int().positive(),
  nombre: z.string().min(1).max(200),
  email: z.string().email().transform(v => v.toLowerCase().trim()),
  telefono: z.string().max(50).optional(),
  producto_interes_id: z.number().int().positive().optional(),
  canal: z.enum([
    'directo', 'referido', 'meta_ads',
    'google_ads', 'tiktok_ads', 'organico',
    'chatgpt_ia'
  ]).default('directo'),
  notas: z.string().max(2000).optional(),
});
```

Reutiliza el modelo existente `createLeadWithRoundRobin`.

## Atajo de teclado global

```js
// frontend/src/App.jsx o AppLayout
useEffect(() => {
  const handler = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setQuickCreateOpen(true);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

## Estado actual

**PENDIENTE implementar.** Requiere:
1. Endpoint POST /api/leads en backend
2. Componente QuickCreateModal en frontend
3. Boton Plus en Navbar
4. Keyboard shortcut Cmd+K
