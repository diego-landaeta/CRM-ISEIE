// Catalogo de campos destino del CRM por tipo de destination.
// El frontend usa esto para construir los selectores de mapping.
// Cada campo: { key, label, type, required, group }

export const TARGETS_CATALOG = {
  product: [
    { key: 'nombre',         label: 'Nombre',                  type: 'string', required: true,  group: 'Basico' },
    { key: 'sku',            label: 'SKU / Codigo',            type: 'string', group: 'Basico' },
    { key: 'descripcion',    label: 'Descripcion',             type: 'text',   group: 'Basico' },
    { key: 'precio',         label: 'Precio',                  type: 'number', group: 'Precio' },
    { key: 'moneda',         label: 'Moneda (EUR/USD/...)',    type: 'string', group: 'Precio' },
    { key: 'duracion',       label: 'Duracion (ej. 8 sesiones)', type: 'string', group: 'Detalle' },
    { key: 'url_info',       label: 'URL de la landing',       type: 'string', group: 'Detalle' },
    { key: 'image_url',      label: 'URL imagen',              type: 'string', group: 'Detalle' },
    { key: 'stripe_link',    label: 'Link de pago Stripe',     type: 'string', group: 'Pagos' },
    { key: 'brochure_url',   label: 'URL del folleto/brochure (PDF)', type: 'string', group: 'Pagos' },
    { key: 'categoria_id',   label: 'Categoria (resuelve por nombre o ID)', type: 'category', group: 'Categorizacion' },
    { key: 'external_id',    label: 'ID externo (para idempotencia)', type: 'string', group: 'Avanzado' },
    // Array anidado - para modulos del programa
    { key: '_modules',       label: 'Modulos (array de objetos)', type: 'array_subfield', group: 'Subitems',
      subfields: [
        { key: 'titulo',      label: 'Titulo del modulo',  type: 'string', required: true },
        { key: 'descripcion', label: 'Descripcion',        type: 'text' },
        { key: 'horas',       label: 'Horas',              type: 'number' },
      ],
    },
    // Wildcard para custom_fields
    { key: 'custom_fields.*', label: 'Campo personalizado (custom_fields)', type: 'wildcard_object', group: 'Custom' },
  ],

  lead: [
    { key: 'nombre',     label: 'Nombre',     type: 'string', required: true, group: 'Basico' },
    { key: 'email',      label: 'Email',      type: 'string', required: true, group: 'Basico' },
    { key: 'telefono',   label: 'Telefono',   type: 'string', group: 'Basico' },
    { key: 'notas',      label: 'Notas',      type: 'text',   group: 'Basico' },
    { key: 'producto_interes_id', label: 'Producto de interes (ID)', type: 'product_ref', group: 'Detalle' },
    { key: 'landing_url', label: 'URL landing origen', type: 'string', group: 'Detalle' },
    { key: 'utm_source',  label: 'UTM source',     type: 'string', group: 'UTM' },
    { key: 'utm_medium',  label: 'UTM medium',     type: 'string', group: 'UTM' },
    { key: 'utm_campaign',label: 'UTM campaign',   type: 'string', group: 'UTM' },
    { key: 'custom_fields.*', label: 'Campo personalizado (custom_fields)', type: 'wildcard_object', group: 'Custom' },
  ],

  matricula: [
    { key: 'dni',     label: 'DNI/NIE', type: 'string', required: true, group: 'Basico' },
    { key: 'titulo',  label: 'Titulo',  type: 'string', group: 'Basico' },
    { key: 'notas',   label: 'Notas',   type: 'text',   group: 'Basico' },
  ],

  category: [
    { key: 'nombre',    label: 'Nombre',                type: 'string', required: true, group: 'Basico' },
    { key: 'parent_id', label: 'Padre (resolucion por nombre o ID)', type: 'category', group: 'Jerarquia' },
    { key: 'orden',     label: 'Orden',                 type: 'number', group: 'Jerarquia' },
  ],
};

// Lista de transformaciones disponibles para el frontend
export const TRANSFORMS_CATALOG = [
  { id: 'trim',       label: 'Trim (quitar espacios)' },
  { id: 'lowercase',  label: 'Minusculas' },
  { id: 'uppercase',  label: 'MAYUSCULAS' },
  { id: 'parseInt',   label: 'Convertir a entero' },
  { id: 'parseFloat', label: 'Convertir a decimal' },
  { id: 'stripHtml',  label: 'Quitar HTML' },
  { id: 'slug',       label: 'Convertir a slug' },
  { id: 'regex:PATRON', label: 'Regex captura grupo 1' },
];
