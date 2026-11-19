import { Link } from 'react-router-dom';
import { Power, Ear, EarSlash, Trash, GraduationCap, Users, ArrowRight } from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import type { Webhook, WebhookDestination } from '../lib/types';

interface DestMeta { Icon: PhosphorIcon; label: string; }

const DEST_META: Record<WebhookDestination, DestMeta> = {
  lead: { Icon: Users, label: 'Lead' },
  matricula: { Icon: GraduationCap, label: 'Solicitud de admisión' },
};

// La card recibe webhook con un campo extra `awaiting_sample` derivado en server
type WebhookCardItem = Webhook & { awaiting_sample?: boolean };

interface WebhookCardProps {
  webhook: WebhookCardItem;
  onToggleActive: (w: WebhookCardItem) => void;
  onToggleListen: (w: WebhookCardItem) => void;
  onDelete: (w: WebhookCardItem) => void;
  /** `forms.edit` en el servidor: encender, apagar y escuchar. */
  puedeEditar?: boolean;
  /** `forms.delete` en el servidor. */
  puedeBorrar?: boolean;
}

export default function WebhookCard({ webhook, onToggleActive, onToggleListen, onDelete, puedeEditar = true, puedeBorrar = true }: WebhookCardProps) {
  const dest = DEST_META[webhook.destination] || DEST_META.lead;
  const DestIcon = dest.Icon;
  const mappedCount = Object.keys(webhook.field_mapping || {}).length;

  return (
    <div
      className={`bg-card border rounded-2xl p-4 flex items-center gap-4 ${
        !webhook.active
          ? 'opacity-60 border-border'
          : webhook.awaiting_sample
          ? 'border-amber-400 ring-2 ring-amber-200 dark:ring-amber-900/40'
          : 'border-border'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold">{webhook.nombre}</h3>
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">
            <DestIcon size={10} weight="bold" /> {dest.label}
          </span>
          {webhook.awaiting_sample && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 font-bold animate-pulse">
              ● ESCUCHANDO
            </span>
          )}
          {!webhook.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-bold">INACTIVO</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {/* Los que crearon algo; los rechazados están en el historial de su ficha. */}
          {mappedCount} campos mapeados · {webhook.submissions_count || 0} procesados · <code>{webhook.embed_id}</code>
        </p>
      </div>

      {puedeEditar && <button
        onClick={() => onToggleActive(webhook)}
        className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold ${
          webhook.active
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            : 'bg-muted text-muted-foreground'
        }`}
        title={webhook.active ? 'Apagar webhook (no recibe más)' : 'Encender webhook'}
      >
        <Power size={12} weight="bold" /> {webhook.active ? 'ON' : 'OFF'}
      </button>}

      {puedeEditar && webhook.active && (
        <button
          onClick={() => onToggleListen(webhook)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold ${
            webhook.awaiting_sample ? 'bg-amber-500 text-white' : 'bg-muted'
          }`}
          title={webhook.awaiting_sample ? 'Apagar escucha' : 'Esperar payload de prueba'}
        >
          {webhook.awaiting_sample ? (
            <><EarSlash size={12} weight="bold" /> Escucha OFF</>
          ) : (
            <><Ear size={12} weight="bold" /> Escucha ON</>
          )}
        </button>
      )}

      <Link
        to={`/conexion/webhooks/prospectos/${webhook.id}`}
        className="flex items-center gap-1 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity"
      >
        Detalle <ArrowRight size={12} weight="bold" />
      </Link>

      {puedeBorrar && <button
        onClick={() => onDelete(webhook)}
        className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500"
        title="Eliminar webhook"
        aria-label={`Eliminar ${webhook.nombre}`}
      >
        <Trash size={14} />
      </button>}
    </div>
  );
}
