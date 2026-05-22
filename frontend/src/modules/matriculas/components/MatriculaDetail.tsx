import { useState } from 'react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { CheckCircle, XCircle, Clock, Upload, X } from '@phosphor-icons/react';

interface Matricula {
  id: number;
  lead_nombre?: string;
  lead_email?: string;
  producto_contratado?: string;
  dni?: string;
  titulo?: string;
  notas?: string;
  estado?: string;
  motivo_rechazo?: string;
  dni_doc_url?: string;
  titulo_doc_url?: string;
  firma_url?: string;
  [key: string]: any;
}

interface Props {
  matricula: Matricula;
  onClose: () => void;
  onChange: () => void;
  onEstado: (m: Matricula, estado: string) => void;
}

export default function MatriculaDetail({ matricula, onClose, onChange, onEstado }: Props) {
  const [m, setM] = useState<Matricula>(matricula);
  const [uploading, setUploading] = useState<string | null>(null);

  async function handleUpload(tipo: string, file?: File) {
    if (!file) return;
    setUploading(tipo);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await client.post(`/matriculas/${m.id}/doc/${tipo}`, fd);
      if (res.success) { setM(res.data); toast({ title: 'Documento subido' }); onChange(); }
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
    finally { setUploading(null); }
  }

  async function handleSaveCampos() {
    try {
      const res = await client.patch(`/matriculas/${m.id}`, { dni: m.dni || null, titulo: m.titulo || null, notas: m.notas || null });
      if (res.success) { setM(res.data); toast({ title: 'Guardado' }); onChange(); }
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }

  return (
    <div className="fixed inset-0 !m-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="matricula-detail-title" className="bg-card rounded-2xl border border-border max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h3 id="matricula-detail-title" className="font-extrabold">{m.lead_nombre}</h3>
            <p className="text-xs text-muted-foreground">{m.producto_contratado} · {m.lead_email}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="p-1.5 rounded hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="font-bold uppercase text-muted-foreground">DNI</span>
              <input value={m.dni || ''} onChange={e => setM({ ...m, dni: e.target.value })} className="mt-1 w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </label>
            <label className="block text-xs">
              <span className="font-bold uppercase text-muted-foreground">Título</span>
              <input value={m.titulo || ''} onChange={e => setM({ ...m, titulo: e.target.value })} className="mt-1 w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </label>
          </div>
          <label className="block text-xs">
            <span className="font-bold uppercase text-muted-foreground">Notas</span>
            <textarea value={m.notas || ''} onChange={e => setM({ ...m, notas: e.target.value })} rows={2} className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </label>
          <button
            onClick={handleSaveCampos}
            className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Guardar campos
          </button>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-border">
            {['dni', 'titulo', 'firma'].map(tipo => (
              <div key={tipo} className="border border-border rounded-xl p-3">
                <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">{tipo}</p>
                {m[tipo === 'firma' ? 'firma_url' : `${tipo}_doc_url`] ? (
                  <a href={m[tipo === 'firma' ? 'firma_url' : `${tipo}_doc_url`]} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">Ver documento</a>
                ) : <p className="text-xs text-muted-foreground">Sin doc</p>}
                <label className="block mt-2 cursor-pointer">
                  <input type="file" className="hidden" accept="image/*,application/pdf" onChange={e => handleUpload(tipo, e.target.files?.[0])} />
                  <span className="flex items-center gap-1 px-2 py-1 rounded bg-muted text-[11px] font-bold hover:bg-muted/70"><Upload size={12} /> {uploading === tipo ? 'Subiendo...' : 'Subir'}</span>
                </label>
              </div>
            ))}
          </div>

          {m.estado === 'rechazada' && m.motivo_rechazo && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 rounded-lg text-xs text-red-700 dark:text-red-300"><strong>Motivo:</strong> {m.motivo_rechazo}</div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            {m.estado !== 'validada' && (
              <button
                onClick={() => onEstado(m, 'validada')}
                className="flex items-center gap-1 h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                <CheckCircle size={14} weight="bold" /> Validar
              </button>
            )}
            {m.estado !== 'rechazada' && (
              <button
                onClick={() => onEstado(m, 'rechazada')}
                className="flex items-center gap-1 h-9 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                <XCircle size={14} weight="bold" /> Rechazar
              </button>
            )}
            {m.estado !== 'pendiente' && (
              <button
                onClick={() => onEstado(m, 'pendiente')}
                className="flex items-center gap-1 h-9 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              >
                <Clock size={14} weight="bold" /> Pendiente
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
