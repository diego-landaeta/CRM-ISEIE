import { useEffect, useState } from 'react';
import { GlobeHemisphereWest } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { ponerAmbito } from '@/shared/lib/ambitoInforme';
import { etiquetaCampusPais } from '@/shared/lib/paises';

/**
 * Prospectos y ventas por campus y PAÍS DE ENTRADA (#221): «Psiko Aprende ·
 * México», «Fono Aprende · Chile». El país es el del subdominio por el que
 * entró el prospecto, no el del teléfono (ese es «Países» de los rankings).
 *
 * Solo se pinta si algún campus del ámbito separa por país: en los demás sería
 * una tabla con una sola fila «sin país» que no dice nada.
 */

interface Fila {
  project_id: number;
  campus: string | null;
  pais: string | null;
  leads: number;
  leads_convertidos: number;
  tasa_conversion: number;
  ventas: number;
  clientes: number;
  vendido: number;
  cobrado: number;
}

const eur = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat('es-ES').format(n || 0);

export default function PaisesDeEntrada({ from, to, issuerId = null, project = null }: {
  from: string; to: string; issuerId?: number | null; project?: { id?: number | null } | null;
}) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setError(null);
    const p = new URLSearchParams({ from, to });
    ponerAmbito(p, { activeIssuerId: issuerId, activeProject: project });
    client.get(`/informes/paises-entrada?${p.toString()}`)
      .then((r: { success?: boolean; data?: Fila[] }) => { if (vivo) setFilas(r?.success ? (r.data || []) : []); })
      .catch((e: { message?: string }) => { if (vivo) { setFilas([]); setError(e?.message || 'No se pudo cargar'); } });
    return () => { vivo = false; };
  }, [from, to, issuerId, project?.id]);

  if (!filas) return null;
  // Sin ningún país en el ámbito no hay nada que separar.
  if (!error && !filas.some((f) => f.pais)) return null;

  const total = filas.reduce((t, f) => ({
    leads: t.leads + f.leads, ventas: t.ventas + f.ventas, vendido: t.vendido + f.vendido, cobrado: t.cobrado + f.cobrado,
  }), { leads: 0, ventas: 0, vendido: 0, cobrado: 0 });
  const sinPais = filas.filter((f) => !f.pais).reduce((n, f) => n + f.leads, 0);

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5" data-testid="paises-de-entrada">
      <div className="mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <GlobeHemisphereWest size={16} /> Por país de entrada
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          El país del subdominio por el que entró cada prospecto (cl., mx.…). Las ventas cuentan en el país de su prospecto.
          {total.leads > 0 && sinPais > 0 && (
            <> {' '}{num(sinPais)} de {num(total.leads)} prospectos sin país: dominio raíz, prefijo sin configurar o sin dirección de entrada.</>
          )}
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-medium">Campus · País</th>
                <th className="py-2 px-3 font-medium text-right">Prospectos</th>
                <th className="py-2 px-3 font-medium text-right">Convertidos</th>
                <th className="py-2 px-3 font-medium text-right">Tasa</th>
                <th className="py-2 px-3 font-medium text-right">Ventas</th>
                <th className="py-2 px-3 font-medium text-right">Vendido</th>
                <th className="py-2 pl-3 font-medium text-right">Cobrado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.project_id}-${f.pais || 'sin'}`} className="border-b border-border/60 last:border-0">
                  <td className={`py-2 pr-3 ${f.pais ? '' : 'text-muted-foreground'}`}>
                    {f.pais ? etiquetaCampusPais(f.campus, f.pais) : `${f.campus || '—'} · sin país`}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{num(f.leads)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{num(f.leads_convertidos)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{f.leads ? `${f.tasa_conversion}%` : '—'}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{num(f.ventas)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{eur(f.vendido)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{eur(f.cobrado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
