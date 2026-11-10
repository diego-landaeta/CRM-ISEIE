// Países, formaciones y canales de origen: los rankings, en pantalla y descargables.
//
// Los canales (#48) dicen de dónde vienen los prospectos y cuánto dinero dejan.
// «Sin origen» va aparte y a la vista: su porcentaje es lo que dice si la web y
// Make están trayendo el origen de verdad.
//
// El país sale del PREFIJO DEL TELÉFONO, no de la columna de país fiscal: esa
// tiene «España» por defecto en casi todos los leads y daría un 99% falso.
//
// Cada fila es pulsable: abre las ventas que la componen.
import { useEffect, useMemo, useState } from 'react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { GlobeHemisphereWest, ListChecks, FileCsv, Signpost } from '@phosphor-icons/react';
import DetalleMetricaDialog from '@/shared/components/DetalleMetricaDialog';

const fmtMoney = (n) => new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(n || 0));
const fmtNum = (n) => new Intl.NumberFormat('es-ES').format(Number(n || 0));

const CANALES = {
  meta_ads: 'Meta Ads', google_ads: 'Google Ads', tiktok_ads: 'TikTok Ads', organico: 'Orgánico',
  chatgpt_ia: 'ChatGPT / IA', directo: 'Directo', referido: 'Referido', whatsapp: 'WhatsApp', sin_origen: 'Sin origen',
};
const etiquetaCanal = (c) => CANALES[c] || c || 'Sin origen';

const VISTAS = {
  paises: {
    etiqueta: 'Países', icon: GlobeHemisphereWest, endpoint: '/informes/paises', clave: 'pais',
    ayuda: 'Deducido del prefijo del teléfono del cliente. Los que no tienen teléfono quedan aparte, no repartidos.',
    cols: [
      { k: 'pais', h: 'País' },
      { k: 'ventas', h: 'Ventas', t: 'num' },
      { k: 'clientes', h: 'Clientes', t: 'num' },
      { k: 'vendido', h: 'Vendido', t: 'eur' },
      { k: 'cobrado', h: 'Cobrado', t: 'eur' },
    ],
  },
  canales: {
    etiqueta: 'Canales', titulo: 'Origen de los prospectos', icon: Signpost, endpoint: '/informes/canales', clave: 'canal',
    sinDetalle: true,
    ayuda: 'De dónde llegó cada prospecto y cuánto se ha vendido y cobrado por canal. «Sin origen» son los prospectos de los que no se sabe nada: no se reparten entre los demás.',
    cols: [
      { k: 'canal', h: 'Canal', t: 'canal' },
      { k: 'leads', h: 'Prospectos', t: 'num' },
      { k: 'pct_prospectos', h: '% prospectos', t: 'pct' },
      { k: 'ventas', h: 'Ventas', t: 'num' },
      { k: 'vendido', h: 'Vendido', t: 'eur' },
      { k: 'cobrado', h: 'Cobrado', t: 'eur' },
    ],
  },
  formaciones: {
    etiqueta: 'Formaciones', icon: ListChecks, endpoint: '/informes/formaciones', clave: 'formacion',
    ayuda: 'La columna «origen» dice si la formación viene del catálogo o de texto tecleado a mano en la venta.',
    cols: [
      { k: 'formacion', h: 'Formación' },
      { k: 'origen', h: 'Origen' },
      { k: 'ventas', h: 'Ventas', t: 'num' },
      { k: 'clientes', h: 'Clientes', t: 'num' },
      { k: 'vendido', h: 'Vendido', t: 'eur' },
      { k: 'ticket_medio', h: 'Ticket medio', t: 'eur' },
    ],
  },
};

export default function RankingsPanel({ from, to }) {
  const { activeProject } = useProjectContext();
  const [vista, setVista] = useState('paises');
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busca, setBusca] = useState('');
  const [detalle, setDetalle] = useState(null);
  const conf = VISTAS[vista];

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true);
      try {
        const p = new URLSearchParams();
        if (activeProject?.id) p.set('projectId', String(activeProject.id));
        if (from) p.set('from', from);
        if (to) p.set('to', to);
        const r = await client.get(`${conf.endpoint}?${p.toString()}`);
        if (vivo) setFilas(r.success ? (r.data || []) : []);
      } catch {
        if (vivo) setFilas([]);
      } finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [activeProject?.id, from, to, conf.endpoint]);

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return t ? filas.filter((f) => String(f[conf.clave] || '').toLowerCase().includes(t)) : filas;
  }, [filas, busca, conf.clave]);

  // Solo en la vista de canales: cuántos prospectos no traen ninguna pista de origen.
  const sinOrigen = vista === 'canales' ? filas.find((f) => f.canal === 'sin_origen') : null;

  const maxVendido = useMemo(
    () => Math.max(1, ...visibles.map((f) => Number(f.vendido || 0))), [visibles],
  );
  const total = useMemo(() => visibles.reduce((acc, f) => ({
    ventas: acc.ventas + Number(f.ventas || 0),
    vendido: acc.vendido + Number(f.vendido || 0),
  }), { ventas: 0, vendido: 0 }), [visibles]);

  function descargarCsv() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linea = (f) => conf.cols.map((c) => {
      const v = f[c.k];
      if (c.t === 'canal') return esc(etiquetaCanal(v));
      return c.t ? esc(String(v ?? 0).replace('.', ',')) : esc(v);
    }).join(';');
    const csv = [conf.cols.map((c) => esc(c.h)).join(';'), ...visibles.map(linea)].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }));
    a.download = `${vista}-${from || 'inicio'}_${to || 'hoy'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <conf.icon size={18} weight="regular" /> {conf.titulo || `${conf.etiqueta} más vendidos`}
          </h2>
          <p className="text-xs text-muted-foreground max-w-2xl">{conf.ayuda}</p>
          {!conf.sinDetalle && (
            <p className="text-xs text-primary font-medium mt-1">
              Pulsa una fila para ver sus ventas una a una.
            </p>
          )}
          {sinOrigen && (
            <p className="text-xs font-medium mt-1 text-warning-soft-foreground">
              Sin origen: {fmtNum(sinOrigen.leads)} prospectos ({String(sinOrigen.pct_prospectos).replace('.', ',')} %).
              {Number(sinOrigen.pct_prospectos) > 0 ? ' Cuanto más bajo, mejor llega el origen desde la web y Make.' : ''}
            </p>
          )}
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {Object.entries(VISTAS).map(([k, v]) => (
            <button
              key={k}
              type="button"
              onClick={() => { setVista(k); setBusca(''); }}
              className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                vista === k ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {v.etiqueta}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={`Buscar ${conf.etiqueta.toLowerCase()}…`}
          className="h-8 px-2.5 rounded-md border border-border bg-background text-xs flex-1 min-w-[180px]"
        />
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {visibles.length} filas · {fmtNum(total.ventas)} ventas · {fmtMoney(total.vendido)}
        </span>
        <button
          type="button"
          onClick={descargarCsv}
          disabled={!visibles.length}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted disabled:opacity-40"
        >
          <FileCsv size={14} weight="bold" /> Descargar CSV
        </button>
      </div>

      {cargando ? (
        <p className="text-sm text-muted-foreground py-4">Cargando…</p>
      ) : !visibles.length ? (
        <p className="text-sm text-muted-foreground py-4">
          {conf.sinDetalle ? 'No hay prospectos en el rango seleccionado.' : 'No hay ventas en el rango seleccionado.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {conf.cols.map((c) => (
                  <th key={c.k} className={`px-3 py-2 font-bold ${c.t && c.t !== 'canal' ? 'text-right' : 'text-left'}`}>{c.h}</th>
                ))}
                <th className="px-3 py-2 font-bold text-left w-28">Peso</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr
                  key={f[conf.clave]}
                  onClick={conf.sinDetalle ? undefined : () => setDetalle({
                    consulta: {
                      tipo: 'ventas',
                      projectId: activeProject?.id || '',
                      from, to,
                      [conf.clave]: f[conf.clave],
                    },
                    subtitulo: `${f[conf.clave]} · ${fmtNum(f.ventas)} ventas · ${fmtMoney(f.vendido)}`,
                  })}
                  className={`border-b border-border/50 last:border-0 hover:bg-muted/40 ${conf.sinDetalle ? '' : 'cursor-pointer'}`}
                >
                  {conf.cols.map((c) => (
                    <td key={c.k} className={`px-3 py-2 ${c.t && c.t !== 'canal' ? 'text-right tabular-nums' : ''} ${c.k === 'vendido' ? 'font-semibold' : ''}`}>
                      {c.t === 'eur' ? fmtMoney(f[c.k])
                        : c.t === 'num' ? fmtNum(f[c.k])
                          : c.t === 'pct' ? `${String(f[c.k] ?? 0).replace('.', ',')} %`
                            : c.t === 'canal' ? etiquetaCanal(f[c.k])
                              : (f[c.k] || '—')}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <span className="block h-1.5 rounded-full bg-primary/70"
                      style={{ width: `${Math.max(3, (Number(f.vendido || 0) / maxVendido) * 100)}%` }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DetalleMetricaDialog
        abierto={!!detalle}
        onClose={() => setDetalle(null)}
        consulta={detalle?.consulta}
        subtitulo={detalle?.subtitulo}
      />
    </section>
  );
}
