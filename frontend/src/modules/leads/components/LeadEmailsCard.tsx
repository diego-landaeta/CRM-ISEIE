import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { EnvelopeSimple, PaperPlaneTilt, CaretDown, CaretRight, Spinner, Lightning } from '@phosphor-icons/react';
import { leadEmailsApi, type LeadEmail } from '../api/lead-emails.api';

interface LeadEmailsCardProps {
  leadId: number;
  hasEmail: boolean;
  onCompose: () => void;
  onEnrollSequence?: () => void;
  refreshKey?: number; // change to force re-fetch (e.g. tras enviar)
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function LeadEmailsCard({ leadId, hasEmail, onCompose, onEnrollSequence, refreshKey }: LeadEmailsCardProps) {
  const [emails, setEmails] = useState<LeadEmail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setEmails(null);
    setError(null);
    (async () => {
      try {
        const res = await leadEmailsApi.list(leadId);
        if (cancelled) return;
        if (res.success && res.data) setEmails(res.data);
        else setError('No se pudo cargar el historial');
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error de red');
      }
    })();
    return () => { cancelled = true; };
  }, [leadId, refreshKey]);

  function toggle(id: number): void {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="bg-card p-5 rounded-lg border border-border">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h3 className="font-semibold flex items-center gap-2">
          <EnvelopeSimple size={16} weight="regular" /> Emails enviados
          {emails && emails.length > 0 && (
            <span className="text-xs font-medium text-muted-foreground tabular-nums">({emails.length})</span>
          )}
        </h3>
        <div className="flex items-center gap-1.5">
          {onEnrollSequence && (
            <button
              type="button"
              onClick={onEnrollSequence}
              disabled={!hasEmail}
              title={hasEmail ? 'Enrolar en secuencia automática' : 'Lead sin email — añade uno primero'}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Lightning size={12} weight="bold" /> Enrolar
            </button>
          )}
          <button
            type="button"
            onClick={onCompose}
            disabled={!hasEmail}
            title={hasEmail ? 'Componer email' : 'Lead sin email — añade uno primero'}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold border border-primary/30 text-primary hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <PaperPlaneTilt size={12} weight="bold" /> Enviar
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-md p-3">
          {error}
        </div>
      )}

      {!emails && !error && (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
          <Spinner size={16} className="animate-spin mr-2" /> Cargando…
        </div>
      )}

      {emails && emails.length === 0 && (
        <p className="text-sm text-muted-foreground italic text-center py-6">
          Aún no se han enviado emails a este lead.
        </p>
      )}

      {emails && emails.length > 0 && (
        <ul className="divide-y divide-border -mx-2">
          {emails.map((e) => {
            const isOpen = expanded.has(e.id);
            return (
              <li key={e.id} className="px-2">
                <button
                  type="button"
                  onClick={() => toggle(e.id)}
                  className="w-full text-left py-2.5 flex items-start gap-2 hover:bg-muted/30 rounded-md transition-colors px-2 -mx-2"
                >
                  {isOpen
                    ? <CaretDown size={12} className="mt-1.5 text-muted-foreground shrink-0" />
                    : <CaretRight size={12} className="mt-1.5 text-muted-foreground shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{e.subject}</span>
                      <time className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        {formatDateTime(e.sent_at)}
                      </time>
                    </div>
                    {e.user_nombre && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">por {e.user_nombre}</p>
                    )}
                  </div>
                </button>
                {isOpen && (
                  <div className="ml-6 mb-3 mr-2 p-3 bg-muted/30 border border-border rounded-md">
                    { }
                    <div
                      className="text-xs leading-relaxed prose-sm max-w-none [&_a]:text-primary [&_a]:underline"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(e.body_html) }}
                    />
                    {e.brevo_msg_id && (
                      <p className="text-[10px] text-muted-foreground mt-2 font-mono">
                        Brevo ID: {e.brevo_msg_id}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
