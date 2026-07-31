// Popup con las filas que hay detrás de un número del panel.
//
// Nació de una duda concreta: "Daniela tiene 9 ventas, ¿de verdad son 9 nuevas?".
// En vez de ir preguntando caso por caso, se pulsa el número y se ven.
// Lleva buscador y descarga en CSV de lo que estés viendo.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import client from '@/shared/api/client';
import { X, MagnifyingGlass, FileCsv } from '@phosphor-icons/react';

const fmtEur = (n) => new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(n || 0));

function fecha(d) {
  if (!d) return '—';
  const x = new Date(String(d).length === 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(x.getTime()) ? String(d)
    : x.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
}

// Qué columnas enseñar según lo que se haya pulsado.
const COLUMNAS = {
  leads: [
    { k: 'fecha', h: 'Entrada', t: 'date' }, { k: 'cliente', h: 'Nombre' },
    { k: 'email', h: 'Email' }, { k: 'telefono', h: 'Teléfono' },
    { k: 'estado', h: 'Estado' }, { k: 'asesora', h: 'Asesora' },
    { k: 'ventas', h: 'Ventas', t: 'num' },
  ],
  ventas: [
    { k: 'fecha', h: 'Fecha', t: 'date' }, { k: 'cliente', h: 'Cliente' },
    { k: 'es_mensualidad', h: 'Tipo', t: 'esmens' },
    // 'Venta total' y no 'Importe': es el precio de la venta entera, que se leía
    // como si fuera el cobro de ese mes y no cuadraba con la columna de al lado.
    { k: 'formacion', h: 'Formación' }, { k: 'importe', h: 'Venta total', t: 'eur' },
    // 'Venta total' es el precio del curso; 'Como venta' es lo que cuenta este
    // mes en la metrica de ventas, que es el cobro que la abre.
    { k: 'como_venta', h: 'Como venta', t: 'eur' },
    { k: 'cobrado', h: 'Cobrado', t: 'eur' }, { k: 'cobros', h: 'Nº cobros', t: 'pagos' },
    { k: 'ventas_previas', h: 'Compras antes', t: 'num' },
    { k: 'asesora', h: 'Asesora' }, { k: 'facturas', h: 'Facturas' },
  ],
  mensualidades: [
    { k: 'fecha', h: 'Cobro', t: 'date' }, { k: 'cliente', h: 'Cliente' },
    { k: 'importe', h: 'Importe', t: 'eur' }, { k: 'cuota', h: 'Cuota', t: 'num' },
    { k: 'formacion', h: 'Formación' }, { k: 'fecha_venta', h: 'Venta de', t: 'date' },
    // Cobro y factura no siempre caen en el mismo mes: se cobra el 25 de junio y
    // se factura el 26 de julio. Con las dos fechas a la vista se entiende en
    // que mes cuenta la fila segun el criterio elegido arriba.
    { k: 'factura', h: 'Factura' }, { k: 'emitida', h: 'Facturada', t: 'date' },
    { k: 'asesora', h: 'Asesora' },
  ],
  cobros: [
    { k: 'fecha', h: 'Cobro', t: 'date' }, { k: 'cliente', h: 'Cliente' },
    { k: 'importe', h: 'Importe', t: 'eur' },
    { k: 'es_primer_cobro', h: 'Tipo', t: 'tipo' },
    { k: 'formacion', h: 'Formación' }, { k: 'factura', h: 'Factura' },
    { k: 'emitida', h: 'Facturada', t: 'date' },
    { k: 'asesora', h: 'Asesora' },
  ],
};
COLUMNAS['cobros-venta'] = COLUMNAS.cobros;
COLUMNAS['leads-convertidos'] = COLUMNAS.leads;

const TITULOS = {
  leads: 'Leads entrados',
  'leads-convertidos': 'Leads del periodo que compraron',
  ventas: 'Ventas cerradas',
  mensualidades: 'Mensualidades cobradas',
  cobros: 'Cobros',
  'cobros-venta': 'Cobros de venta nueva',
};

// Las cifras van a la derecha; el resto, a la izquierda.
const ES_CIFRA = new Set(['eur', 'num', 'pagos']);

function celda(col, fila) {
  const v = fila[col.k];
  if (col.t === 'eur') return fmtEur(v);
  if (col.t === 'date') return fecha(v);
  if (col.t === 'num') return v == null ? '—' : String(v);
  // En palabras y en plural: una venta con un segundo pago (un complemento) se
  // veía como un '2' suelto y nadie caía en que ahí había dos cobros. Va también
  // al CSV, que es donde más se pierde el matiz.
  if (col.t === 'pagos') {
    const n = Number(v || 0);
    if (!n) return '—';
    return n === 1 ? '1 pago' : `${n} pagos`;
  }
  if (col.t === 'tipo') return v ? 'venta' : 'mensualidad';
  // Al reves que 'tipo': aqui el true es el caso malo, el que no deberia estar.
  if (col.t === 'esmens') return v ? 'mensualidad' : 'venta nueva';
  return v == null || v === '' ? '—' : String(v);
}

// El title por defecto es el valor crudo. En las dos columnas que cuentan juntas
// la historia del cobro fraccionado se explica con palabras.
function titulo(col, fila) {
  const n = Number(fila.cobros || 0);
  if (n > 1 && col.t === 'pagos') return `Esta venta se ha cobrado en ${n} veces`;
  if (n > 1 && col.k === 'cobrado') return `Suma de los ${n} cobros de esta venta`;
  return String(fila[col.k] ?? '');
}

export default function DetalleMetricaDialog({ abierto, onClose, consulta, subtitulo }) {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    if (!abierto || !consulta) return;
    let vivo = true;
    setCargando(true);
    setBusca('');
    const q = new URLSearchParams();
    Object.entries(consulta).forEach(([k, v]) => { if (v != null && v !== '') q.set(k, String(v)); });
    client.get(`/reports/detalle?${q.toString()}`)
      .then((r) => { if (vivo) setFilas(r.success ? (r.data || []) : []); })
      .catch(() => { if (vivo) setFilas([]); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [abierto, consulta]);

  // Cerrar con Escape, que es lo que espera todo el mundo.
  useEffect(() => {
    if (!abierto) return;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [abierto, onClose]);

  const cols = COLUMNAS[consulta?.tipo] || COLUMNAS.ventas;

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return filas;
    return filas.filter((f) => cols.some((c) => String(f[c.k] ?? '').toLowerCase().includes(t)));
  }, [filas, busca, cols]);

  // Suma de lo que se está viendo: si filtras, la suma sigue al filtro.
  const total = useMemo(() => {
    const col = cols.find((c) => c.t === 'eur');
    return col ? visibles.reduce((s, f) => s + Number(f[col.k] || 0), 0) : null;
  }, [visibles, cols]);

  function descargarCsv() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = cols.map((c) => esc(c.h)).join(',');
    const body = visibles.map((f) => cols.map((c) => esc(celda(c, f))).join(',')).join('\n');
    const blob = new Blob([`﻿${head}\n${body}`], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${consulta?.tipo || 'detalle'}-${consulta?.mes || 'rango'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  if (!abierto) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-6xl max-h-[86vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="font-semibold">{TITULOS[consulta?.tipo] || 'Detalle'}</h3>
            <p className="text-[11px] text-muted-foreground">
              {subtitulo}
              {filas.length >= 500 && ' · mostrando las 500 más recientes'}
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted flex-shrink-0" aria-label="Cerrar">
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar en estas filas…"
              className="w-full h-9 pl-8 pr-2 rounded-md border border-border bg-background text-sm"
            />
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {visibles.length} de {filas.length}
            {total != null && ` · ${fmtEur(total)}`}
          </span>
          <button type="button" onClick={descargarCsv} disabled={!visibles.length}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-semibold hover:bg-muted disabled:opacity-40">
            <FileCsv size={14} weight="bold" /> CSV
          </button>
        </div>

        <div className="overflow-auto flex-1">
          {cargando ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : !visibles.length ? (
            <p className="p-6 text-sm text-muted-foreground">
              {filas.length ? 'Nada coincide con la búsqueda.' : 'No hay registros.'}
            </p>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 text-muted-foreground sticky top-0">
                <tr>
                  {cols.map((c) => (
                    <th key={c.k}
                      className={`px-3 py-2 font-bold whitespace-nowrap ${ES_CIFRA.has(c.t) ? 'text-right' : 'text-left'}`}>
                      {c.h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => (
                  <tr key={f.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                    {cols.map((c) => (
                      <td key={c.k}
                        className={`px-3 py-1.5 ${ES_CIFRA.has(c.t) ? 'text-right tabular-nums' : ''} ${c.t === 'eur' ? 'font-semibold' : ''} ${c.t === 'esmens' && f[c.k] ? 'text-amber-600 dark:text-amber-500 font-semibold' : ''} ${c.t === 'pagos' && Number(f[c.k] || 0) > 1 ? 'text-sky-600 dark:text-sky-400 font-semibold' : ''}`}>
                        <span className="block max-w-[240px] truncate" title={titulo(c, f)}>
                          {celda(c, f)}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
