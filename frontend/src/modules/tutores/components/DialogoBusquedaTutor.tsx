import { useEffect, useMemo, useState } from 'react';
import { X, MagnifyingGlass, MegaphoneSimple } from '@phosphor-icons/react';
import { inputClass } from '@/shared/lib/ui';
import { cn } from '@/shared/lib/utils';
import type { AnuncioMeta, FormacionSinTutor } from '../api/tutores.api';

/**
 * «¿Se está buscando tutor para esta formación?».
 *
 * Son dos preguntas y no una, y por eso hay dos controles:
 *
 *   1. Se busca o no. Vale por sí sola: se busca tutor por WhatsApp y por
 *      conocidos mucho antes de pagar un anuncio, y eso también hay que poder
 *      decirlo.
 *   2. Y además hay un anuncio, este. Opcional.
 *
 * El anuncio se ELIGE de la lista de Meta en vez de escribirse: el CRM ya tiene
 * las campañas sincronizadas, y teclear un identificador de veinte cifras a mano
 * es pedir una errata que nadie va a notar.
 */
export default function DialogoBusquedaTutor({
  formacion, anuncios, cargandoAnuncios, guardando, onGuardar, onCerrar,
}: {
  formacion: FormacionSinTutor;
  anuncios: AnuncioMeta[];
  cargandoAnuncios: boolean;
  guardando: boolean;
  onGuardar: (d: { buscando: boolean; adsetId: string | null; nota: string | null }) => void;
  onCerrar: () => void;
}) {
  const [buscando, setBuscando] = useState(formacion.buscando);
  const [adsetId, setAdsetId] = useState(formacion.anuncio_id || '');
  const [nota, setNota] = useState(formacion.busqueda_nota || '');
  const [q, setQ] = useState('');

  useEffect(() => {
    function alEscape(e: KeyboardEvent) { if (e.key === 'Escape') onCerrar(); }
    document.addEventListener('keydown', alEscape);
    return () => document.removeEventListener('keydown', alEscape);
  }, [onCerrar]);

  // Los del proyecto de la formación primero: un anuncio de otro proyecto casi
  // nunca es el que se busca, pero no se esconde — hay campañas compartidas.
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtrados = t
      ? anuncios.filter((a) => `${a.campana} ${a.nombre}`.toLowerCase().includes(t))
      : anuncios;
    return [...filtrados].sort((a, b) =>
      Number(b.project_id === formacion.project_id) - Number(a.project_id === formacion.project_id));
  }, [anuncios, q, formacion.project_id]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Búsqueda de tutor"
      className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCerrar} aria-hidden="true" />
      <div className="relative z-10 flex max-h-full w-full flex-col overflow-hidden rounded-none border border-border bg-card shadow-xl sm:max-w-2xl sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">¿Se busca tutor?</h2>
            <p className="mt-0.5 text-xs text-muted-foreground truncate">{formacion.nombre}</p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 1 · Se busca o no. */}
          <div className="flex gap-2">
            {[
              { v: true, t: 'Sí, se busca tutor' },
              { v: false, t: 'No se está buscando' },
            ].map((o) => (
              <button key={String(o.v)} type="button" onClick={() => setBuscando(o.v)}
                className={cn('flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                  buscando === o.v
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted')}>
                {o.t}
              </button>
            ))}
          </div>

          {/* 2 · Y además, el anuncio. */}
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-sm font-medium">
                Anuncio de Meta <span className="text-muted-foreground font-normal">(si lo hay)</span>
              </label>
              {adsetId && (
                <button type="button" onClick={() => setAdsetId('')}
                  className="text-xs text-muted-foreground hover:underline">Quitar el anuncio</button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Se busca tutor con o sin anuncio. Engancharlo aquí es lo que hace que la
              columna META diga si está activo y cuánto lleva gastado.
            </p>

            <div className="relative mt-2">
              <MagnifyingGlass size={14} weight="bold"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar campaña o conjunto…"
                className={cn(inputClass, 'pl-8')} />
            </div>

            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {cargandoAnuncios ? (
                <p className="p-3 text-sm text-muted-foreground">cargando anuncios…</p>
              ) : lista.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  {anuncios.length === 0
                    ? 'No hay anuncios sincronizados en este ámbito. Se puede marcar que se busca tutor igualmente.'
                    : 'Ningún anuncio con ese nombre.'}
                </p>
              ) : lista.map((a) => (
                <button key={a.adset_id} type="button" onClick={() => setAdsetId(a.adset_id)}
                  className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50',
                    adsetId === a.adset_id && 'bg-primary/10')}>
                  <MegaphoneSimple size={14} weight={a.parece_de_tutores ? 'fill' : 'regular'}
                    className={a.parece_de_tutores ? 'text-primary shrink-0' : 'text-muted-foreground shrink-0'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.nombre}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.campana}</span>
                  </span>
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
                    a.status === 'ACTIVE'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-muted text-muted-foreground')}>
                    {a.status === 'ACTIVE' ? 'activo' : 'pausado'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Nota</label>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2}
              maxLength={500} placeholder="Por dónde se está buscando, con quién se habló…"
              className={cn(inputClass, 'h-auto py-2')} />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button type="button" onClick={onCerrar}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
          <button type="button" disabled={guardando}
            onClick={() => onGuardar({
              buscando,
              // Si se deja de buscar, el anuncio se guarda igual: es la respuesta
              // a «¿esto ya lo intentamos?», y borrarlo la perdería.
              adsetId: adsetId || null,
              nota: nota.trim() || null,
            })}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
