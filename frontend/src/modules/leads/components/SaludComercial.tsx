import RepartoEnBarras from '@/shared/components/ui/RepartoEnBarras';

/**
 * Cómo están repartidos los prospectos por estado.
 *
 * La pantalla empezaba directamente en la tabla, y estos números ya venían del
 * servidor: solo se usaban para unas píldoras dentro del desplegable de
 * filtros, donde no los ve nadie.
 *
 * Las barras viven en `RepartoEnBarras`, que usa también Clientes con su
 * reparto de cobros. Aquí queda el embudo y sus nombres.
 */

interface Stats {
  total?: number;
  nuevo?: number;
  por_contactar?: number;
  contactado?: number;
  en_seguimiento?: number;
  convertido?: number;
  no_interesado?: number;
}

// El orden es el del embudo, no el alfabético: «por contactar» va antes que
// «contactado» aunque la letra diga lo contrario.
const ESTADOS: Array<{ clave: keyof Stats; etiqueta: string; barra: string }> = [
  { clave: 'nuevo', etiqueta: 'Nuevos', barra: 'bg-info' },
  { clave: 'por_contactar', etiqueta: 'Por contactar', barra: 'bg-warning' },
  { clave: 'contactado', etiqueta: 'Contactados', barra: 'bg-muted-foreground/50' },
  { clave: 'en_seguimiento', etiqueta: 'En seguimiento', barra: 'bg-warning' },
  { clave: 'convertido', etiqueta: 'Convertidos', barra: 'bg-success' },
  { clave: 'no_interesado', etiqueta: 'No interesados', barra: 'bg-destructive' },
];

export default function SaludComercial({
  stats, onFiltroEstado, onVerPipeline,
}: {
  stats: Stats;
  onFiltroEstado?: (estado: string) => void;
  onVerPipeline?: () => void;
}) {
  return (
    <RepartoEnBarras
      titulo="Salud comercial"
      descripcion="Cómo están repartidos los prospectos que estás viendo."
      total={stats.total ?? 0}
      filas={ESTADOS.map((e) => ({
        clave: String(e.clave),
        etiqueta: e.etiqueta,
        barra: e.barra,
        n: stats[e.clave] ?? 0,
      }))}
      onFila={onFiltroEstado}
      accion={onVerPipeline ? { texto: 'Pipeline', onClick: onVerPipeline } : undefined}
    />
  );
}
