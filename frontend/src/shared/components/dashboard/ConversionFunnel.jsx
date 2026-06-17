import { ArrowRight } from '@phosphor-icons/react';

const STAGES = [
  { key: 'nuevo',          label: 'Nuevo',          color: '#3b82f6' },
  { key: 'por_contactar',  label: 'Por contactar',  color: '#f59e0b' },
  { key: 'contactado',     label: 'Contactado',     color: '#10b981' },
  { key: 'en_seguimiento', label: 'En seguimiento', color: '#eab308' },
  { key: 'convertido',     label: 'Convertido',     color: '#8b5cf6' },
];

export default function ConversionFunnel({ stats, total }) {
  if (!total || total === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="font-semibold mb-1">Embudo de conversión</h3>
        <p className="text-[11px] text-muted-foreground">Aún no hay leads suficientes para mostrar el embudo.</p>
      </div>
    );
  }

  const stageCounts = STAGES.map((s) => ({ ...s, count: Number(stats?.[s.key] || 0) }));
  const maxCount = Math.max(...stageCounts.map((s) => s.count), 1);

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <div>
          <h3 className="font-semibold">Embudo de conversión</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Cómo avanzan los leads por las etapas</p>
        </div>
        <span className="text-[10px] font-bold text-muted-foreground uppercase">Total {total}</span>
      </div>

      <div className="space-y-2">
        {stageCounts.map((stage, i) => {
          const pctOfTotal = total > 0 ? Math.round((stage.count / total) * 100) : 0;
          const widthPct = Math.max((stage.count / maxCount) * 100, 4);
          const prevCount = i > 0 ? stageCounts[i - 1].count : null;
          const dropOff = prevCount !== null && prevCount > 0
            ? Math.round(((prevCount - stage.count) / prevCount) * 100)
            : null;

          return (
            <div key={stage.key} className="space-y-1">
              {dropOff !== null && dropOff > 0 && (
                <div className="flex items-center gap-1 pl-1 text-[10px] text-muted-foreground">
                  <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" />
                  <span>{dropOff}% no avanza a la siguiente etapa</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="w-32 flex-shrink-0 text-xs font-medium truncate">{stage.label}</div>
                <div className="flex-1 h-7 bg-muted/40 rounded-md overflow-hidden relative">
                  <div
                    className="h-full transition-all duration-300 flex items-center px-2"
                    style={{ width: `${widthPct}%`, background: stage.color }}
                  >
                    <span className="text-[11px] font-bold text-white drop-shadow-sm tabular-nums">
                      {stage.count}
                    </span>
                  </div>
                </div>
                <div className="w-12 flex-shrink-0 text-xs text-right tabular-nums text-muted-foreground">
                  {pctOfTotal}%
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Tasa de conversión</span>
        <span className="font-bold tabular-nums text-violet-600 dark:text-violet-400">
          {total > 0 ? Math.round((Number(stats?.convertido || 0) / total) * 100) : 0}%
          <ArrowRight size={10} weight="bold" className="inline ml-1 opacity-60" />
        </span>
      </div>
    </div>
  );
}
