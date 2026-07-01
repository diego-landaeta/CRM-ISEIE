import { useState, useEffect, useCallback, useRef } from 'react';
import { FilePdf, Receipt, Certificate, Download, Trash, Eye, X, ArrowsOut, Copy, ArrowsClockwise, ListMagnifyingGlass, EnvelopeSimple } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/shared/hooks/useToast';
import { documentsApi, type CrmDocument, type DocumentType } from '../api/documents.api';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import InvoiceForm, { type InvoiceFormValues } from '../components/InvoiceForm';
import CertificateForm from '../components/CertificateForm';
import AuditDrawer from '../components/AuditDrawer';
import { getAccessToken } from '@/shared/api/client';

type TabKey = 'list' | 'invoice' | 'certificate';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'list', label: 'Historial' },
  { key: 'certificate', label: 'Nuevo Certificado' },
];

const TYPE_LABEL: Record<DocumentType, string> = { invoice: 'Factura', certificate: 'Certificado' };

interface PreviewModalProps {
  doc: CrmDocument;
  onClose: () => void;
}

// ─── Modal de previsualización ────────────────────────────────────────────────
function PreviewModal({ doc, onClose }: PreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const baseUrl = (import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '');
        const token = getAccessToken() || '';
        const res = await fetch(`${baseUrl}/api/documents/preview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ type: doc.type, data: doc.data }),
        });
        if (!res.ok) {
          // Backend respondió error — NO inyectamos el body (puede ser HTML/JSON
          // y se renderizaría en el iframe con riesgo XSS).
          setHtml(`<p style="padding:2rem;color:#dc2626;font-family:sans-serif">Error ${res.status} al generar la previsualización.</p>`);
          return;
        }
        const text = await res.text();
        setHtml(text);
      } catch {
        setHtml('<p style="padding:2rem;color:red">Error al cargar la previsualización</p>');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [doc]);

  useEffect(() => {
    if (!html || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const doc2 = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc2) return;
    doc2.open();
    doc2.write(html);
    doc2.close();
  }, [html]);

  function openNewTab() {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="doc-preview-title" className="bg-card rounded-xl border border-border shadow-2xl flex flex-col w-full max-w-5xl max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <FilePdf size={18} className="text-primary" />
            <span id="doc-preview-title" className="font-semibold text-sm">{doc.number}</span>
            <span className="text-xs text-muted-foreground">{TYPE_LABEL[doc.type]}</span>
            {doc.client_nombre && (
              <span className="text-xs text-muted-foreground">— {doc.client_nombre}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openNewTab}
              aria-label="Abrir previsualización en pestaña nueva"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-xs font-medium border border-border hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
              title="Abrir en pestaña nueva"
            >
              <ArrowsOut size={13} /> <span className="hidden sm:inline">Pantalla completa</span>
            </button>
            <button
              onClick={onClose}
              aria-label="Cerrar previsualización"
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-hidden relative bg-muted/30">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          )}
          <iframe
            ref={iframeRef}
            className="w-full h-full border-0"
            style={{ minHeight: '70vh' }}
            title="Previsualización del documento"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function DocumentsPage() {
  const { activeProject } = useProjectContext();
  const { user } = useAuth();
  const role = (user as { role?: string } | null)?.role;
  const isSuperadmin = role === 'superadmin';
  const [tab, setTab] = useState<TabKey>('list');
  const [docs, setDocs] = useState<CrmDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CrmDocument | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState<number | null>(null);
  const [resending, setResending] = useState<number | null>(null);
  const [auditing, setAuditing] = useState<CrmDocument | null>(null);
  const [previewing, setPreviewing] = useState<CrmDocument | null>(null);
  const [duplicateSeed, setDuplicateSeed] = useState<Partial<InvoiceFormValues> | null>(null);

  function handleDuplicate(doc: CrmDocument): void {
    if (doc.type !== 'invoice') {
      toast({ title: 'Sólo se pueden duplicar facturas por ahora' });
      return;
    }
    // El doc.data tiene shape arbitrario — extraemos los campos del form
    const d = doc.data as Record<string, unknown>;
    setDuplicateSeed({
      cliente_nombre: (d.cliente_nombre as string) || (d.client_nombre as string) || '',
      cliente_dni: (d.cliente_dni as string) || (d.client_dni as string) || '',
      cliente_direccion: (d.cliente_direccion as string) || (d.client_direccion as string) || '',
      lineas: (d.lineas as InvoiceFormValues['lineas']) || [{ descripcion: '', cantidad: 1, precio: '' }],
      iva_pct: (d.iva_pct as number) ?? 21,
      iva_exento: (d.iva_exento as boolean) ?? true,
      // fecha no se duplica (siempre se usa hoy)
    });
    setTab('invoice');
    toast({ title: `Duplicando ${doc.number}`, description: 'Revisa los datos y genera la nueva factura' });
  }

  const load = useCallback(async () => {
    if (!activeProject?.id) return;
    setLoading(true);
    try {
      const res = await documentsApi.list(activeProject.id);
      if (res.success) {
        const data = res.data as CrmDocument[];
        setDocs(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      toast({
        title: 'Error cargando documentos',
        description: err?.data?.error || err.message || 'No se pudo conectar con el servidor.',
        variant: 'destructive',
      });
    }
    finally { setLoading(false); }
  }, [activeProject?.id]);

  useEffect(() => { load(); }, [load]);

  async function handleDownload(doc: CrmDocument): Promise<void> {
    if (!activeProject?.id) return;
    setDownloading(doc.id);
    try {
      const baseUrl = (import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '');
      const token = getAccessToken() || '';
      const res = await fetch(`${baseUrl}/api/documents/${doc.id}/download?projectId=${activeProject.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al descargar');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Error al descargar', variant: 'destructive' });
    } finally { setDownloading(null); }
  }

  async function handleResendEmail(doc: CrmDocument): Promise<void> {
    if (!activeProject?.id) return;
    setResending(doc.id);
    try {
      const res = await documentsApi.resendEmail(doc.id, activeProject.id);
      if (res.success && res.data) {
        toast({ title: 'Email enviado', description: res.data.to });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo enviar';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally { setResending(null); }
  }

  async function handleRegenerate(doc: CrmDocument): Promise<void> {
    if (!activeProject?.id) return;
    setRegenerating(doc.id);
    try {
      const res = await documentsApi.regenerate(doc.id, activeProject.id);
      if (res.success) {
        toast({ title: 'PDF regenerado', description: doc.number });
        load();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo regenerar';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally { setRegenerating(null); }
  }

  async function doDelete(): Promise<void> {
    if (!pendingDelete || !activeProject?.id) return;
    try {
      await documentsApi.remove(pendingDelete.id, activeProject.id);
      toast({ title: 'Documento eliminado' });
      load();
    } catch {
      toast({ title: 'Error al eliminar', variant: 'destructive' });
    } finally { setPendingDelete(null); }
  }

  function onGenerated(): void {
    setTab('list');
    setDuplicateSeed(null);
    load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certificados"
        subtitle={`Certificados y diplomas de ${activeProject?.nombre || ''}. Las facturas se emiten en Finanzas → Facturación.`}
        actions={
          <>
            <button
              type="button"
              onClick={() => setTab('certificate')}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Certificate size={15} /> <span className="hidden sm:inline">Nuevo</span> Certificado
            </button>
          </>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              if (t.key !== 'invoice') setDuplicateSeed(null);
            }}
            className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Historial */}
      {tab === 'list' && (
        <div>
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : docs.length === 0 ? (
            <EmptyState
              icon={FilePdf}
              title="Sin documentos aún"
              description="Genera tu primera factura o certificado para verlos aquí."
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block bg-card rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/30">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Número</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Tipo</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Cliente / Alumno</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Fecha</th>
                      <th className="px-4 py-3"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {docs.map(doc => (
                      <tr key={doc.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-semibold">{doc.number}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            doc.type === 'invoice'
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                              : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                          }`}>
                            {doc.type === 'invoice' ? <Receipt size={11} /> : <Certificate size={11} />}
                            {TYPE_LABEL[doc.type]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{doc.client_nombre || '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {new Date(doc.created_at).toLocaleDateString('es-ES')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              type="button"
                              onClick={() => setPreviewing(doc)}
                              aria-label={`Previsualizar ${doc.number}`}
                              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                              title="Previsualizar"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownload(doc)}
                              disabled={downloading === doc.id}
                              aria-label={`Descargar PDF ${doc.number}`}
                              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                              title="Descargar PDF"
                            >
                              <Download size={14} />
                            </button>
                            {doc.type === 'invoice' && (
                              <button
                                type="button"
                                onClick={() => handleDuplicate(doc)}
                                aria-label={`Duplicar ${doc.number}`}
                                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                                title="Duplicar como nueva factura"
                              >
                                <Copy size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRegenerate(doc)}
                              disabled={regenerating === doc.id}
                              aria-label={`Regenerar PDF ${doc.number}`}
                              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-amber-500 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                              title="Regenerar PDF desde datos guardados"
                            >
                              <ArrowsClockwise size={14} className={regenerating === doc.id ? 'animate-spin' : ''} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResendEmail(doc)}
                              disabled={resending === doc.id}
                              aria-label={`Reenviar por email ${doc.number}`}
                              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-cyan-500 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                              title="Reenviar por email al cliente/alumno"
                            >
                              <EnvelopeSimple size={14} className={resending === doc.id ? 'animate-pulse' : ''} />
                            </button>
                            {isSuperadmin && (
                              <button
                                type="button"
                                onClick={() => setAuditing(doc)}
                                aria-label={`Ver auditoría de ${doc.number}`}
                                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                title="Ver historial de auditoría"
                              >
                                <ListMagnifyingGlass size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setPendingDelete(doc)}
                              aria-label={`Eliminar ${doc.number}`}
                              className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/40"
                              title="Eliminar"
                            >
                              <Trash size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {docs.map(doc => (
                  <div key={doc.id} className="bg-card border border-border rounded-lg p-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          doc.type === 'invoice'
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                        }`}>
                          {doc.type === 'invoice' ? <Receipt size={10} /> : <Certificate size={10} />}
                          {TYPE_LABEL[doc.type]}
                        </span>
                        <span className="font-mono text-[11px] font-semibold">{doc.number}</span>
                      </div>
                      <p className="text-sm truncate">{doc.client_nombre || '—'}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(doc.created_at).toLocaleDateString('es-ES')}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setPreviewing(doc)}
                        aria-label={`Previsualizar ${doc.number}`}
                        className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownload(doc)}
                        disabled={downloading === doc.id}
                        aria-label={`Descargar PDF ${doc.number}`}
                        className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground disabled:opacity-50"
                      >
                        <Download size={13} />
                      </button>
                      {doc.type === 'invoice' && (
                        <button
                          type="button"
                          onClick={() => handleDuplicate(doc)}
                          aria-label={`Duplicar ${doc.number}`}
                          className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-primary"
                        >
                          <Copy size={13} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPendingDelete(doc)}
                        aria-label={`Eliminar ${doc.number}`}
                        className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500"
                      >
                        <Trash size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'invoice' && <InvoiceForm onGenerated={onGenerated} initialValues={duplicateSeed || undefined} />}
      {tab === 'certificate' && <CertificateForm onGenerated={onGenerated} />}

      {/* Modal preview */}
      {previewing && (
        <PreviewModal doc={previewing} onClose={() => setPreviewing(null)} />
      )}

      {/* Audit drawer (solo superadmin) */}
      {auditing && isSuperadmin && activeProject?.id && (
        <AuditDrawer doc={auditing} projectId={activeProject.id} onClose={() => setAuditing(null)} />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="¿Eliminar documento?"
        message={`Se eliminará ${pendingDelete?.number} permanentemente.`}
        tone="destructive"
        confirmLabel="Eliminar"
        onConfirm={doDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
