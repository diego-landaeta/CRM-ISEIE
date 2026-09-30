// Catálogo de campos destino del CRM por tipo de destination.
// El frontend usa esto para construir los selectores de mapping.
// Cada campo: { key, label, type, required, group }

export const TARGETS_CATALOG = {
  product: [
    { key: 'nombre',         label: 'Nombre',                  type: 'string', required: true,  group: 'Básico' },
    { key: 'sku',            label: 'SKU / Código',            type: 'string', group: 'Básico' },
    { key: 'descripcion',    label: 'Descripción',             type: 'text',   group: 'Básico' },
    { key: 'precio',         label: 'Precio',                  type: 'number', group: 'Precio' },
    { key: 'moneda',         label: 'Moneda (EUR/USD/...)',    type: 'string', group: 'Precio' },
    { key: 'duracion',       label: 'Duración (ej. 8 sesiones)', type: 'string', group: 'Detalle' },
    { key: 'url_info',       label: 'URL de la landing',       type: 'string', group: 'Detalle' },
    { key: 'image_url',      label: 'URL imagen',              type: 'string', group: 'Detalle' },
    { key: 'stripe_link',    label: 'Link de pago Stripe',     type: 'string', group: 'Pagos' },
    { key: 'brochure_url',   label: 'URL del folleto/brochure (PDF)', type: 'string', group: 'Pagos' },
    { key: 'categoria_id',   label: 'Categoría (resuelve por nombre o ID)', type: 'category', group: 'Categorización' },
    { key: 'external_id',    label: 'ID externo (para idempotencia)', type: 'string', group: 'Avanzado' },
    // Array anidado — para módulos del programa
    { key: '_modules',       label: 'Módulos (array de objetos)', type: 'array_subfield', group: 'Subitems',
      subfields: [
        { key: 'titulo',      label: 'Título del módulo',  type: 'string', required: true },
        { key: 'descripcion', label: 'Descripción',        type: 'text' },
        { key: 'horas',       label: 'Horas',              type: 'number' },
      ],
    },
    // Wildcard para custom_fields
    { key: 'custom_fields.*', label: 'Campo personalizado (custom_fields)', type: 'wildcard_object', group: 'Custom' },
  ],

  lead: [
    { key: 'nombre',     label: 'Nombre',     type: 'string', required: true, group: 'Básico' },
    { key: 'email',      label: 'Email',      type: 'string', required: true, group: 'Básico' },
    { key: 'telefono',   label: 'Teléfono',   type: 'string', group: 'Básico' },
    { key: 'notas',      label: 'Notas',      type: 'text',   group: 'Básico' },
    { key: 'producto_interes_id', label: 'Producto de interés (ID)', type: 'product_ref', group: 'Detalle' },
    { key: 'landing_url', label: 'URL landing origen', type: 'string', group: 'Detalle' },
    { key: 'utm_source',  label: 'UTM source',     type: 'string', group: 'UTM' },
    { key: 'utm_medium',  label: 'UTM medium',     type: 'string', group: 'UTM' },
    { key: 'utm_campaign',label: 'UTM campaign',   type: 'string', group: 'UTM' },
    { key: 'custom_fields.*', label: 'Campo personalizado (custom_fields)', type: 'wildcard_object', group: 'Custom' },
  ],

  matricula: [
    { key: 'dni',     label: 'DNI/NIE', type: 'string', required: true, group: 'Básico' },
    { key: 'titulo',  label: 'Título',  type: 'string', group: 'Básico' },
    { key: 'notas',   label: 'Notas',   type: 'text',   group: 'Básico' },
  ],

  category: [
    { key: 'nombre',    label: 'Nombre',                type: 'string', required: true, group: 'Básico' },
    { key: 'parent_id', label: 'Padre (resolución por nombre o ID)', type: 'category', group: 'Jerarquía' },
    { key: 'orden',     label: 'Orden',                 type: 'number', group: 'Jerarquía' },
  ],
};

// Lista de transformaciones disponibles para el frontend
export const TRANSFORMS_CATALOG = [
  { id: 'trim',       label: 'Trim (quitar espacios)' },
  { id: 'lowercase',  label: 'Minúsculas' },
  { id: 'uppercase',  label: 'MAYÚSCULAS' },
  { id: 'parseInt',   label: 'Convertir a entero' },
  { id: 'parseFloat', label: 'Convertir a decimal' },
  { id: 'stripHtml',  label: 'Quitar HTML' },
  { id: 'slug',       label: 'Convertir a slug' },
  { id: 'regex:PATRÓN', label: 'Regex captura grupo 1' },
];
