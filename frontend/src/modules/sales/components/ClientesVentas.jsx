import { useEffect, useMemo, useState } from 'react';
import { UserList, Warning, CaretDown, CaretUp } from '@phosphor-icons/react';
import client from '@/shared/api/client';

// Quién compra y quién debe, del mismo periodo que el resto de la pantalla.
//
// Dos pestañas sobre la misma lista, no dos consultas: «Quién más compra»
// ordena por importe y «Quién debe» deja solo a los que tienen saldo. Así los
// dos números salen del mismo sitio y no pueden contradecirse.
//
// El cobrado sale de los cobros registrados, no de conversions.importe_pagado:
// ese campo viene inflado de la carga de junio y aquí habría dicho que un
// cliente está al día cuando no lo está.

const eur = (n) => new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(n) || 0);
const num = (n) => new Intl.NumberFormat('es-ES').format(Number(n) || 0);

const VISTAS = [
  { clave: 'compra', etiqueta: 'Quién más compra' },
  { clave: 'debe', etiqueta: 'Quién debe' },
];

export default function ClientesVentas({ projectId = null, from = null, to = null, responsableId = null, tope = 10 }) {
  const [filas, setFilas] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState('compra');
  const [abierto, setAbierto] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError(null);
    const params = { limit: 200, page: 1 };
    if (projectId) params.projectId = projectId;
    if (from && to) { params.from = from; params.to = to; }
    if (responsableId) params.responsableId = responsableId;
    client.get('/sales/por-cliente', { params })
      .then((r) => {
        if (!vivo) return;
        setFilas(r.success ? (r.data || []) : []);
        setTotal(r?.pagination?.total || 0);
      })
      .catch((e) => { if (vivo) setError(e?.message || 'No se pudieron cargar los clientes'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [projectId, from, to, responsableId]);

  const { lista, deudaTotal, cuantosDeben } = useMemo(() => {
    const limpias = filas.map((f) => ({
      id: f.lead_id,
      nombre: f.cliente || 'Sin nombre',
      email: f.email || '',
      ventas: Number(f.ventas) || 0,
      importe: Number(f.importe) || 0,
      cobrado: Number(f.cobrado) || 0,
      pendiente: Number(f.pendiente) || 0,
      vencidas: Number(f.cuotas_vencidas) || 0,
      asesoras: f.asesoras || '',
    }));
    // Un céntimo de redondeo no es una deuda.
    const deben = limpias.filter((f) => f.pendiente > 0.01);
    return {
      lista: vista === 'debe'
        ? [...deben].sort((a, b) => b.pendiente - a.pendiente)
        : [...limpias].sort((a, b) => b.importe - a.importe),
      deudaTotal: deben.reduce((a, f) => a + f.pendiente, 0),
      cuantosDeben: deben.length,
    };
  }, [filas, vista]);

  if (cargando) return <div className="bg-card border border-border rounded-lg p-6 h-[300px] animate-pulse" />;
  if (error) {
    return <div className="bg-card border border-border rounded-lg p-6 text-sm text-red-600 dark:text-red-400">{error}</div>;
  }
  if (!filas.length) return null;

  const visibles = abierto ? lista.slice(0, tope) : [];
  const conDeuda = vista === 'debe';

  return (
    <div className="bg-card border border-border rounded-lg p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <UserList size={18} weight="duotone" className="text-muted-foreground" />
          <div>
            <h3 className="text-base font-bold">Clientes</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {num(total)} en el periodo · {num(cuantosDeben)} con saldo por {eur(deudaTotal)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {VISTAS.map((v) => (
            <button
              key={v.clave} type="button" onClick={() => { setVista(v.clave); setAbierto(true); }}
              aria-pressed={v.clave === vista}
              className={`h-7 px-2.5 rounded-md text-xs font-semibold transition-colors ${
                v.clave === vista ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {v.etiqueta}
            </button>
          ))}
          <button type="button" onClick={() => setAbierto((x) => !x)}
            className="h-7 w-7 grid place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
            title={abierto ? 'Plegar' : 'Desplegar'}>
            {abierto ? <CaretUp size={13} weight="bold" /> : <CaretDown size={13} weight="bold" />}
          </button>
        </div>
      </div>

      {abierto && !lista.length ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Ningún cliente con saldo pendiente en este periodo.
        </p>
      ) : abierto && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left font-semibold py-1.5 pr-2">Cliente</th>
                <th className="text-right font-semibold py-1.5 px-2">Ventas</th>
                <th className="text-right font-semibold py-1.5 px-2">Comprado</th>
                <th className="text-right font-semibold py-1.5 px-2">Cobrado</th>
                <th className="text-right font-semibold py-1.5 pl-2">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-2 max-w-[240px]">
                    <div className="flex items-center gap-1.5">
                      {/* El aviso es icono + texto, no color a secas. */}
                      {f.vencidas > 0 && (
                        <span title={`${f.vencidas} cuotas vencidas`}
                          className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400 shrink-0">
                          <Warning size={11} weight="fill" />{f.vencidas}
                        </span>
                      )}
                      <span className="truncate font-medium">{f.nombre}</span>
                    </div>
                    {f.asesoras && <div className="text-[10px] text-muted-foreground/70 truncate">{f.asesoras}</div>}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{num(f.ventas)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{eur(f.importe)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{eur(f.cobrado)}</td>
                  <td className={`py-1.5 pl-2 text-right tabular-nums font-semibold ${
                    f.pendiente > 0.01 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
                  }`}>
                    {eur(f.pendiente)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista.length > tope && (
            <p className="text-[11px] text-muted-foreground/70 mt-2">
              Se ven los {tope} primeros de {num(lista.length)}
              {conDeuda ? ' con saldo' : ''}. El listado completo está en Clientes.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
