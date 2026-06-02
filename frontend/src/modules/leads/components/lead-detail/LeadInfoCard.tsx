import { useEffect, useState } from 'react';
import { PencilSimple, X, Check } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import InfoField, { inputClass } from './InfoField';
import type { Lead } from '@/shared/types';

interface LeadInfoCardProps {
  lead: Lead;
  onUpdate: (fields: Partial<Lead>) => Promise<void> | void;
}

const CANAL_OPTIONS = [
  { value: 'directo', label: 'Directo' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'meta_ads', label: 'Meta Ads' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'tiktok_ads', label: 'TikTok Ads' },
  { value: 'organico', label: 'Orgánico' },
  { value: 'referido', label: 'Referido' },
  { value: 'chatgpt_ia', label: 'ChatGPT IA' },
];

export default function LeadInfoCard({ lead, onUpdate }: LeadInfoCardProps) {
  const [editMode, setEditMode] = useState(false);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [notas, setNotas] = useState('');
  const [canal, setCanal] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (editMode && lead) {
      setNombre(lead.nombre || '');
      setEmail(lead.email || '');
      setTelefono(lead.telefono || '');
      setNotas(lead.notas || '');
      setCanal((lead as any).canal_detectado || (lead as any).origen || 'directo');
    }
  }, [editMode, lead]);

  async function handleSave() {
    setLoading(true);
    try {
      const fields: Partial<Lead> & { canal?: string } = {};
      if (nombre !== lead.nombre) fields.nombre = nombre.trim();
      if ((email || '') !== (lead.email || '')) (fields as any).email = email.trim() || null;
      if ((telefono || '') !== (lead.telefono || '')) fields.telefono = telefono.trim() || null;
      if ((notas || '') !== (lead.notas || '')) fields.notas = notas.trim() || null;
      const currentCanal = (lead as any).canal_detectado || (lead as any).origen || 'directo';
      if (canal !== currentCanal) fields.canal = canal;
      if (Object.keys(fields).length === 0) {
        setEditMode(false);
        return;
      }
      await onUpdate(fields);
      toast({ title: 'Lead actualizado' });
      setEditMode(false);
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-card p-5 rounded-lg border border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Información del lead</h3>
        {!editMode ? (
          <button onClick={() => setEditMode(true)} className="text-xs font-semibold text-primary hover:underline flex items-center gap-1.5">
            <PencilSimple size={12} weight="bold" /> Editar
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditMode(false)}
              disabled={loading}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2 py-1 rounded hover:bg-muted"
            >
              <X size={12} weight="bold" /> Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 flex items-center gap-1.5 px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              <Check size={12} weight="bold" /> {loading ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        )}
      </div>
      {!editMode ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
          <InfoField label="Nombre">{lead.nombre}</InfoField>
          <InfoField label="Email">{lead.email}</InfoField>
          <InfoField label="Teléfono">{lead.telefono || 'Sin teléfono'}</InfoField>
          <InfoField label="Producto de interés">{lead.producto_nombre || lead.producto_interes || 'Sin producto'}</InfoField>
          <InfoField label="Gestor asignado">{lead.responsable_nombre || 'Sin asignar'}</InfoField>
          <InfoField label="Fecha de solicitud">
            {lead.fecha_solicitud ? new Date(lead.fecha_solicitud).toLocaleString('es-ES') : '--'}
          </InfoField>
          {lead.notas && (
            <div className="sm:col-span-2">
              <InfoField label="Notas">{lead.notas}</InfoField>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Nombre</p>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputClass} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Email</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              className={inputClass}
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Teléfono</p>
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={inputClass} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Canal</p>
            <select value={canal} onChange={(e) => setCanal(e.target.value)} className={inputClass}>
              {CANAL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs text-muted-foreground mb-1.5">Notas</p>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 rounded-md border border-border bg-muted/50 text-sm outline-none resize-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 focus:bg-card placeholder:text-muted-foreground"
            />
          </div>
        </div>
      )}
    </div>
  );
}
