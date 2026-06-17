import { useEffect, useState, useCallback } from 'react';
import { FloppyDisk, ArrowsClockwise } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import { invoicesApi } from '../api/invoices.api';
import type { InvoiceSequence } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

export default function InvoicingConfigPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id?: number | null; nombre?: string } };
  const { user } = useAuth() as { user: { role?: string } | null };
  const pid = activeProject?.id;
  const canEdit = ['admin', 'superadmin', 'soporte'].includes(user?.role || '');

  const [piePagoDefault, setPiePagoDefault] = useState('');
  const [serieDefault, setSerieDefault] = useState('A');
  const [metodoDefault, setMetodoDefault] = useState('transferencia');
  const [sequences, setSequences] = useState<InvoiceSequence[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset secuencia
  const [resetAno, setResetAno] = useState(new Date().getFullYear());
  const [resetSerie, setResetSerie] = useState('A');
  const [resetUltimo, setResetUltimo] = useState(0);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    if (!pid) return;
    const [cfg, seqs] = await Promise.all([
      invoicesApi.getConfig(pid),
      invoicesApi.listSequences(pid),
    ]);
    if (cfg.success && cfg.data) {
      setPiePagoDefault(cfg.data.factura_pie_default || '');
      setSerieDefault(cfg.data.factura_serie_default || 'A');
      setMetodoDefault(cfg.data.factura_metodo_default || 'transferencia');
    }
    if (seqs.success) setSequences(seqs.data || []);
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  async function saveConfig() {
    if (!pid) return;
    setSaving(true);
    try {
      const res = await invoicesApi.updateConfig({
        projectId: pid, piePagoDefault, serieDefault, metodoDefault,
      });
      if (res.success) {
        toast({ title: '✓ Configuración guardada' });
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } finally { setSaving(false); }
  }

  async function resetSequence() {
    if (!pid) return;
    if (!confirm(`Set ${resetAno}/${resetSerie} → próxima factura será ${resetAno}/${String(resetUltimo + 1).padStart(4, '0')}. ¿Continuar?`)) return;
    setResetting(true);
    try {
      const res = await invoicesApi.setSequence({ projectId: pid, ano: resetAno, serie: resetSerie, ultimoNumero: resetUltimo });
      if (res.success) {
        toast({ title: '✓ Secuencia actualizada' });
        await load();
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } finally { setResetting(false); }
  }

  if (!pid) return <div className="p-8 text-muted-foreground">Selecciona un proyecto.</div>;
  if (!canEdit) return <div className="p-8 text-muted-foreground">Solo admin/superadmin/soporte puede ver esta página.</div>;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Configuración de facturación" subtitle={`Defaults y numeración correlativa — ${activeProject?.nombre || ''}`} />

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h3 className="font-semibold text-sm">Defaults por proyecto</h3>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Serie por defecto</label>
          <input value={serieDefault} onChange={(e) => setSerieDefault(e.target.value)} maxLength={10}
            className="w-32 h-9 px-2 rounded-md border border-border bg-background text-sm mt-1" />
          <p className="text-[10px] text-muted-foreground mt-1">Ej: A, B, FAC, 2026...</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Método de pago por defecto</label>
          <select value={metodoDefault} onChange={(e) => setMetodoDefault(e.target.value)}
            className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm mt-1">
            <option value="transferencia">Transferencia bancaria</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="tarjeta_stripe">Tarjeta (Stripe)</option>
            <option value="efectivo">Efectivo</option>
            <option value="bizum">Bizum</option>
            <option value="fraccionado">Pago fraccionado</option>
            <option value="otro">Otro</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Pie de pago por defecto</label>
          <textarea value={piePagoDefault} onChange={(e) => setPiePagoDefault(e.target.value)} rows={5}
            placeholder="Ej:&#10;Datos de pago:&#10;Banco Santander&#10;IBAN ES12 3456 7890 1234 5678 9012&#10;Concepto: Factura N.º (codigo)&#10;Vencimiento: 30 días"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm mt-1 font-mono" />
          <p className="text-[10px] text-muted-foreground mt-1">Aparece al pie del PDF. Editable por factura.</p>
        </div>

        <button onClick={saveConfig} disabled={saving}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
          <FloppyDisk size={14} weight="bold" /> {saving ? 'Guardando…' : 'Guardar defaults'}
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h3 className="font-semibold text-sm">Numeración correlativa</h3>
        <p className="text-xs text-muted-foreground">
          Permite indicar desde qué número arrancan las facturas. Útil para migrar desde otro sistema
          (ej: si ya emitiste 200 facturas, configurá <code className="px-1 bg-muted rounded">último = 200</code> →
          la próxima será 0201).
        </p>

        <div className="grid grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Año</label>
            <input type="number" value={resetAno} onChange={(e) => setResetAno(Number(e.target.value))}
              className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Serie</label>
            <input value={resetSerie} onChange={(e) => setResetSerie(e.target.value)} maxLength={10}
              className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Último número usado</label>
            <input type="number" min="0" value={resetUltimo} onChange={(e) => setResetUltimo(Number(e.target.value))}
              className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm mt-1" />
          </div>
          <button onClick={resetSequence} disabled={resetting}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50">
            <ArrowsClockwise size={14} weight="bold" /> {resetting ? '…' : 'Aplicar'}
          </button>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">Secuencias activas</h4>
          {sequences.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Aún no se ha emitido ninguna factura en este proyecto.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-y">
                <tr>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground">Año</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground">Serie</th>
                  <th className="px-3 py-2 text-right text-xs text-muted-foreground">Último número</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground">Próxima factura</th>
                </tr>
              </thead>
              <tbody>
                {sequences.map(s => (
                  <tr key={`${s.ano}-${s.serie}`} className="border-b last:border-0">
                    <td className="px-3 py-2">{s.ano}</td>
                    <td className="px-3 py-2 font-mono">{s.serie}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.ultimo_numero}</td>
                    <td className="px-3 py-2 font-mono text-primary">{s.ano}/{String(s.ultimo_numero + 1).padStart(4, '0')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
