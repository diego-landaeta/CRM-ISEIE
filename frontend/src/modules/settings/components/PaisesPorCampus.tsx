// #221: la tabla «país por subdominio» de cada campus, en Configuración.
//
// En MultiCRM va como una pestaña más de «Configurar campus»; aquí ese diálogo
// todavía es un esqueleto, así que va como sección propia de Configuración, con
// el campus a elegir arriba. La pestaña es la misma en los dos CRMs (PaisesTab).

import { useCallback, useEffect, useState } from 'react';
import client from '@/shared/api/client';
import PaisesTab from './projectSettings/PaisesTab';

interface Campus { id: number; nombre?: string; paises_por_subdominio?: Record<string, string> | null }

export default function PaisesPorCampus() {
  const [campus, setCampus] = useState<Campus[]>([]);
  const [id, setId] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    const r = await client.get('/projects') as { success?: boolean; data?: Campus[] };
    if (r?.success) {
      setCampus(r.data || []);
      setId((antes) => antes ?? r.data?.[0]?.id ?? null);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const elegido = campus.find((c) => c.id === id);

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
      {campus.length > 1 && (
        <label className="block space-y-1 max-w-sm">
          <span className="text-[13px] font-medium">Campus</span>
          <select
            value={id ?? ''}
            onChange={(e) => setId(Number(e.target.value))}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            {campus.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      )}
      {elegido
        ? <PaisesTab key={elegido.id} project={elegido} onSaved={() => { cargar(); }} />
        : <p className="text-sm text-muted-foreground">Cargando…</p>}
    </div>
  );
}
