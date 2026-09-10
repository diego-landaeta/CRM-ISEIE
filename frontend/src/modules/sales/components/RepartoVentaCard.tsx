import { useCallback, useEffect, useState } from 'react';
import { UsersThree, X, Plus, Trash } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { inputClass } from '@/shared/lib/ui';
import { toast } from '@/shared/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';

/**
 * «Esta venta la atendimos entre dos».
 *
 * Diego: «hay casos que dos gestoras atienden a una persona y vende, y hay que
 * compartirlo, mitad y mitad».
 *
 * QUIEN PUEDE. Verlo, cualquiera: la gestora tiene derecho a saber cómo se
 * repartió su venta. Cambiarlo, solo admin y superadmin — y el backend lo
 * vuelve a comprobar, esto de aquí es únicamente para no enseñar un botón que
 * va a dar 403.
 *
 * QUE PASA CON LOS NUMEROS. La venta sigue siendo UNA para la empresa. Lo que
 * se parte es lo que cuenta cada gestora: media venta y medio importe para cada
 * una. Por eso en el equipo pueden salir 2,5 ventas y la suma sigue cuadrando
 * con el total de arriba.
 */

interface Parte {
  user_id: number;
  nombre: string;
  role: string;
  porcentaje: number;
  importe: number;
}

interface Candidata { id: number; nombre: string; role: string }

interface Reparto {
  conversion_id: number;
  importe_total: number;
  titular: { user_id: number; nombre: string } | null;
  compartida: boolean;
  partes: Parte[];
  repartida_por: string | null;
  repartida_el: string | null;
  nota: string | null;
  candidatas: Candidata[];
}

/** Fila que se edita en el diálogo: el porcentaje va como texto para poder borrarlo. */
interface Fila { user_id: number | ''; porcentaje: string }

function eur(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
}

export default function RepartoVentaCard({ conversionId }: { conversionId: number | string }) {
  const { user } = useAuth();
  const puedeRepartir = user?.role === 'admin' || user?.role === 'superadmin';

  const [data, setData] = useState<Reparto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await client.get<Reparto>(`/conversions/${conversionId}/reparto`);
      if (res.success) setData(res.data);
    } catch {
      // Una venta sin reparto no es un error que haya que gritar: la tarjeta
      // simplemente no aparece.
    } finally { setCargando(false); }
  }, [conversionId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function deshacer() {
    try {
      await client.delete(`/conversions/${conversionId}/reparto`);
      toast({ title: 'Reparto deshecho', description: 'La venta vuelve entera a su vendedora.' });
      cargar();
    } catch (err) {
      toast({
        title: 'No se pudo deshacer',
        description: (err as { message?: string })?.message || '',
        variant: 'destructive',
      });
    }
  }

  if (cargando || !data) return null;

  return (
    <>
      <div className="bg-card border border-border rounded-lg p-4 text-sm">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <UsersThree size={16} weight="duotone" className="text-violet-600" />
            Vendedoras
          </h3>
          {puedeRepartir && (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
            >
              {data.compartida ? 'Cambiar reparto' : 'Repartir venta'}
            </button>
          )}
        </div>

        {!data.compartida ? (
          <>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Vendedora</span>
              <span className="font-medium">{data.titular?.nombre || '—'}</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              La venta cuenta entera para {data.titular?.nombre || 'su vendedora'}.
            </p>
          </>
        ) : (
          <>
            <ul className="space-y-2">
              {data.partes.map((p) => (
                <li key={p.user_id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{p.nombre}</span>
                  <span className="flex items-center gap-2 tabular-nums whitespace-nowrap">
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                      {p.porcentaje}%
                    </span>
                    <span className="text-muted-foreground">{eur(p.importe)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {data.nota && (
              <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground whitespace-pre-line">
                {data.nota}
              </p>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              {data.repartida_por ? `Repartida por ${data.repartida_por}` : 'Venta repartida'}
              {data.repartida_el ? ` · ${new Date(data.repartida_el).toLocaleDateString('es-ES')}` : ''}
              {' · '}cada una suma su parte en Ventas.
            </p>
            {puedeRepartir && (
              <button
                type="button"
                onClick={deshacer}
                className="mt-2 text-[11px] font-medium text-red-600 hover:underline dark:text-red-400"
              >
                Deshacer el reparto
              </button>
            )}
          </>
        )}
      </div>

      {abierto && (
        <DialogoReparto
          data={data}
          onCerrar={() => setAbierto(false)}
          onGuardado={() => { setAbierto(false); cargar(); }}
        />
      )}
    </>
  );
}

function DialogoReparto({
  data, onCerrar, onGuardado,
}: { data: Reparto; onCerrar: () => void; onGuardado: () => void }) {
  // Arranca en 50/50 con la vendedora actual puesta: es el caso de siempre, y
  // así el reparto normal son dos clics y no cinco.
  const [filas, setFilas] = useState<Fila[]>(() =>
    data.partes.length > 1
      ? data.partes.map((p) => ({ user_id: p.user_id, porcentaje: String(p.porcentaje) }))
      : [
        { user_id: data.titular?.user_id ?? '', porcentaje: '50' },
        { user_id: '', porcentaje: '50' },
      ]);
  const [nota, setNota] = useState(data.nota || '');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    function alEscape(e: KeyboardEvent) { if (e.key === 'Escape') onCerrar(); }
    document.addEventListener('keydown', alEscape);
    return () => document.removeEventListener('keydown', alEscape);
  }, [onCerrar]);

  const suma = filas.reduce((a, f) => a + (parseFloat(f.porcentaje) || 0), 0);
  const sumaOk = Math.abs(suma - 100) < 0.01;
  const completas = filas.every((f) => f.user_id !== '' && parseFloat(f.porcentaje) > 0);
  const repetidas = new Set(filas.map((f) => f.user_id)).size !== filas.length;

  function cambiar(i: number, campo: keyof Fila, valor: string) {
    setFilas((prev) => prev.map((f, j) => (j === i
      ? { ...f, [campo]: campo === 'user_id' ? (valor ? Number(valor) : '') : valor }
      : f)));
  }

  function aPartesIguales() {
    const n = filas.length;
    // El resto del reparto se le da a la primera: tres personas son 33,34 +
    // 33,33 + 33,33 y no tres treses que suman 99,99.
    const base = Math.floor((100 / n) * 100) / 100;
    setFilas((prev) => prev.map((f, i) => ({
      ...f,
      porcentaje: String(i === 0 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base),
    })));
  }

  async function guardar() {
    setGuardando(true);
    try {
      await client.put(`/conversions/${data.conversion_id}/reparto`, {
        partes: filas.map((f) => ({ user_id: f.user_id, porcentaje: parseFloat(f.porcentaje) })),
        nota: nota.trim() || null,
      });
      toast({ title: 'Venta repartida', description: 'Cada una suma su parte en Ventas.' });
      onGuardado();
    } catch (err) {
      toast({
        title: 'No se pudo repartir',
        description: (err as { message?: string })?.message || '',
        variant: 'destructive',
      });
    } finally { setGuardando(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Repartir la venta"
      className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCerrar} aria-hidden="true" />
      <div className="relative z-10 flex max-h-full w-full flex-col overflow-hidden rounded-none border border-border bg-card shadow-xl sm:max-w-lg sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Repartir la venta</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {eur(data.importe_total)} — la venta sigue siendo una, se reparte lo que cuenta cada una
            </p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar"
            className="rounded p-1 hover:bg-muted"><X size={18} /></button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {filas.map((f, i) => {
            const pct = parseFloat(f.porcentaje) || 0;
            return (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={f.user_id}
                  onChange={(e) => cambiar(i, 'user_id', e.target.value)}
                  className={`${inputClass} min-w-0 flex-1`}
                >
                  <option value="">Elige a quién…</option>
                  {data.candidatas.map((cd) => (
                    <option key={cd.id} value={cd.id}>{cd.nombre}</option>
                  ))}
                </select>
                <div className="relative w-24 flex-shrink-0">
                  <input
                    type="number" min="0" max="100" step="0.01" value={f.porcentaje}
                    onChange={(e) => cambiar(i, 'porcentaje', e.target.value)}
                    className={`${inputClass} pr-6 text-right`}
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
                <span className="w-20 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {eur(data.importe_total * (pct / 100))}
                </span>
                <button
                  type="button" aria-label="Quitar"
                  disabled={filas.length <= 2}
                  onClick={() => setFilas((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                >
                  <Trash size={15} />
                </button>
              </div>
            );
          })}

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex gap-3">
              <button
                type="button" disabled={filas.length >= 5}
                onClick={() => setFilas((prev) => [...prev, { user_id: '', porcentaje: '0' }])}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-40"
              >
                <Plus size={13} weight="bold" /> Añadir a alguien
              </button>
              <button type="button" onClick={aPartesIguales}
                className="text-xs font-medium text-primary hover:underline">
                A partes iguales
              </button>
            </div>
            <span className={`text-xs font-semibold tabular-nums ${sumaOk ? 'text-muted-foreground' : 'text-red-600 dark:text-red-400'}`}>
              suma {Math.round(suma * 100) / 100}%
            </span>
          </div>

          {!sumaOk && (
            <p className="text-[11px] text-red-600 dark:text-red-400">
              Los porcentajes tienen que sumar 100%.
            </p>
          )}
          {repetidas && (
            <p className="text-[11px] text-red-600 dark:text-red-400">
              Hay una persona repetida.
            </p>
          )}

          <div>
            <label htmlFor="reparto-nota" className="mb-1 block text-xs font-medium text-muted-foreground">
              Por qué se reparte (opcional)
            </label>
            <input
              id="reparto-nota" type="text" value={nota} maxLength={500}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ana la trabajó y Dayana la cerró"
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button type="button" onClick={onCerrar}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
          <button type="button" disabled={guardando || !sumaOk || !completas || repetidas}
            onClick={guardar}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {guardando ? 'Guardando…' : 'Guardar reparto'}
          </button>
        </div>
      </div>
    </div>
  );
}
