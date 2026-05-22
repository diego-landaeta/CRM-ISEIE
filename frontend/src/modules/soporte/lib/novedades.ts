// Changelog del CRM. Cuando exista /api/news este archivo se reemplaza por
// fetch al backend. Mantengo la estructura para migrar sin tocar la UI.

export type NovedadType = 'release' | 'feature' | 'fix' | 'breaking';

export interface Novedad {
  id: string;
  version: string;
  date: string;
  title: string;
  type: NovedadType;
  highlights: string[];
}

export const NOVEDADES: ReadonlyArray<Novedad> = [
  {
    id: 'v0.1.0',
    version: '0.1.0',
    date: '2026-04-28',
    title: 'Beta inicial con polish profundo',
    type: 'release',
    highlights: [
      'Sidebar reorganizado en 6 secciones (Principal, Captacion, Catalogo, Finanzas, Analisis, Sistema)',
      'Drawer de prospectos con 5 tabs (Resumen, Historial, Interacciones, Recordatorios, Emails)',
      'Embudo de conversion + insights automaticos en el dashboard',
      'Webhooks UI separada de Formularios con listen mode + payload mapper',
      'Custom fields multi-entidad (Prospectos / Clientes / Productos)',
      'Roles y Permisos con matriz visual (custom roles esperan backend)',
      'Login y Set-password rediseñados estilo Riot Games',
      'PWA con offline.html, runtime caching, prompt de instalación',
      'Logos reales de proyectos con variantes claro/oscuro',
      'Compresión de espacio en 25+ páginas (h-9 estándar)',
    ],
  },
  {
    id: 'crm-236',
    version: '0.1.0',
    date: '2026-04-27',
    title: 'CRM-236: LeadDrawer + EnrollSequenceModal',
    type: 'feature',
    highlights: [
      'Click en fila de prospecto abre drawer lateral (no navega)',
      'Tab Emails muestra secuencias enroladas con estado',
      'Boton "+ Enrolar en secuencia" desde el drawer',
    ],
  },
  {
    id: 'crm-230',
    version: '0.1.0',
    date: '2026-04-27',
    title: 'CRM-230: Webhooks como modulo independiente',
    type: 'feature',
    highlights: [
      'Pagina /webhooks separada de /forms',
      'Listen mode para capturar payload real de prueba',
      'Mapper visual JSON → campos del lead/matricula',
    ],
  },
  {
    id: 'crm-229',
    version: '0.1.0',
    date: '2026-04-27',
    title: 'CRM-229: Hook usePermission + RolesPage',
    type: 'feature',
    highlights: [
      'Hook usePermission con 4 roles fijos por defecto',
      'Pagina /configuracion/roles con matriz de permisos',
      'Custom roles a la espera del backend (CRM-228)',
    ],
  },
];

export const NOVEDAD_TYPE: Record<NovedadType, { label: string; tone: string }> = {
  release: { label: 'Release',   tone: 'violet' },
  feature: { label: 'Feature',   tone: 'blue' },
  fix:     { label: 'Fix',       tone: 'emerald' },
  breaking:{ label: 'Breaking',  tone: 'red' },
};
