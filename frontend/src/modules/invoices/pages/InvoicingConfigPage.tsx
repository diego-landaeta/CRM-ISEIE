import { useEffect, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FloppyDisk, ArrowsClockwise } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import { invoicesApi } from '../api/invoices.api';
import type { InvoiceSequence, Issuer } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

export default function InvoicingConfigPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id?: number | null; nombre?: string } };
  const { user } = useAuth() as { user: { role?: string } | null };
  const pid = activeProject?.id;
  // Base de facturación (/finanzas en ISEIH, /accounting en ISEIE).
  const invBase = useLocation().pathname.split('/facturas')[0];
  const canEdit = ['admin', 'superadmin', 'soporte'].includes(user?.role || '');

  const [piePagoDefault, setPiePagoDefault] = useState('');
  const [serieDefault, setSerieDefault] = useState('A');
  const [metodoDefault, setMetodoDefault] = useState('transferencia');
  const [sequences, setSequences] = useState<InvoiceSequence[]>([]);
  const [saving, setSaving] = useState(false);
  const [issuers, setIssuers] = useState<Issuer[]>([]);
  const [editingIssuer, setEditingIssuer] = useState<Partial<Issuer> | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [issuerNumInicial, setIssuerNumInicial] = useState('');

  // Reset secuencia
  const [resetAno, setResetAno] = useState(new Date().getFullYear());
  const [resetSerie, setResetSerie] = useState('A');
  const [resetUltimo, setResetUltimo] = useState(0);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    if (!pid) return;
    const [cfg, seqs, iss] = await Promise.all([
      invoicesApi.getConfig(pid),
      invoicesApi.listSequences(pid),
      invoicesApi.listIssuers(pid),
    ]);
    if (cfg.success && cfg.data) {
      setPiePagoDefault(cfg.data.factura_pie_default || '');
      setSerieDefault(cfg.data.factura_serie_default || 'A');
      setMetodoDefault(cfg.data.factura_metodo_default || 'transferencia');
    }
    if (seqs.success) setSequences(seqs.data || []);
    if (iss.success) setIssuers(iss.data || []);
  }, [pid]);

  async function saveIssuer() {
    if (!editingIssuer) return;
    if (!editingIssuer.razon_social?.trim() || !editingIssuer.nif?.trim()) {
      toast({ title: 'Faltan datos', description: 'Razón social y NIF son obligatorios', variant: 'destructive' });
      return;
    }
    try {
      const body = {
        razonSocial: editingIssuer.razon_social, nif: editingIssuer.nif,
        direccion: editingIssuer.direccion, ciudad: editingIssuer.ciudad, cp: editingIssuer.cp,
        pais: editingIssuer.pais || 'España', email: editingIssuer.email, telefono: editingIssuer.telefono,
        iban: editingIssuer.iban, pieDefault: editingIssuer.pie_default, esDefault: editingIssuer.es_default,
        serie: editingIssuer.serie, logoUrl: editingIssuer.logo_url, projectId: pid,
      };
      const res = editingIssuer.id
        ? await invoicesApi.updateIssuer(editingIssuer.id, body)
        : await invoicesApi.createIssuer(body);
      if (!res.success) {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
        return;
      }
      // Si hay un archivo de logo seleccionado, subirlo al servidor usando el id resultante.
      const savedId = res.data?.id ?? editingIssuer.id;
      if (logoFile && savedId) {
        setUploadingLogo(true);
        try {
          await invoicesApi.uploadIssuerLogo(savedId, logoFile);
        } catch (e: any) {
          toast({ title: 'Logo no subido', description: e?.data?.error || e?.message, variant: 'destructive' });
        } finally { setUploadingLogo(false); }
      }
      // Si se indicó "número inicial" y la empresa tiene serie, sembramos la
      // secuencia de esa serie para que la próxima factura arranque desde ahí.
      const serie = (editingIssuer.serie || '').trim();
      const numIni = parseInt(issuerNumInicial, 10);
      if (serie && Number.isFinite(numIni) && numIni >= 0) {
        try {
          await invoicesApi.setSequence({ projectId: pid, ano: new Date().getFullYear(), serie, ultimoNumero: numIni });
        } catch (e: any) {
          toast({ title: 'Serie guardada, pero no pude fijar el número', description: e?.data?.error || e?.message, variant: 'destructive' });
        }
      }
      toast({ title: editingIssuer.id ? '✓ Empresa actualizada' : '✓ Empresa añadida' });
      setEditingIssuer(null);
      setLogoFile(null);
      setIssuerNumInicial('');
      await load();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.data?.error || e?.message, variant: 'destructive' });
    }
  }

  async function removeIssuer(id: number) {
    if (!confirm('¿Eliminar esta empresa emisora? Las facturas ya emitidas conservan sus datos.')) return;
    try {
      await invoicesApi.deleteIssuer(id);
      toast({ title: 'Empresa eliminada' });
      await load();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  }
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
      <PageHeader
        title="Configuración de facturación"
        subtitle={`Defaults y numeración correlativa — ${activeProject?.nombre || ''}`}
        actions={(
          <Link to={`${invBase}/facturas/plantillas`} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
            🎨 Diseñador de facturas
          </Link>
        )}
      />

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

      {/* EMPRESAS EMISORAS (multi-emisor) */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Empresas emisoras</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Empresas desde las que se pueden emitir facturas. Al crear una factura se elige cuál usar.</p>
          </div>
          <button onClick={() => { setLogoFile(null); setEditingIssuer({ pais: 'España', es_default: issuers.length === 0 }); }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
            + Añadir empresa
          </button>
        </div>

        {issuers.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Aún no hay empresas. Añadí al menos una para poder elegir el emisor al facturar.</p>
        ) : (
          <div className="space-y-2">
            {issuers.map(iss => (
              <div key={iss.id} className="flex items-center justify-between border border-border rounded-md px-3 py-2">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    {iss.razon_social}
                    {iss.es_default && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">DEFAULT</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{iss.nif}{iss.ciudad ? ` · ${iss.ciudad}` : ''}{iss.iban ? ` · ${iss.iban}` : ''}</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setLogoFile(null); setEditingIssuer(iss); }} className="h-7 px-2 rounded border border-border text-[11px] hover:bg-muted">Editar</button>
                  <button onClick={() => removeIssuer(iss.id)} className="h-7 px-2 rounded border border-red-300 text-[11px] text-red-600 hover:bg-red-50">Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editingIssuer && (
          <div className="border border-primary/40 rounded-md p-4 space-y-2 bg-primary/5">
            <h4 className="text-xs font-bold uppercase text-muted-foreground">{editingIssuer.id ? 'Editar empresa' : 'Nueva empresa'}</h4>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Razón social *" value={editingIssuer.razon_social || ''} onChange={e => setEditingIssuer({ ...editingIssuer, razon_social: e.target.value })} className="h-9 px-2 rounded border border-border bg-background text-sm" />
              <input placeholder="NIF / CIF *" value={editingIssuer.nif || ''} onChange={e => setEditingIssuer({ ...editingIssuer, nif: e.target.value })} className="h-9 px-2 rounded border border-border bg-background text-sm" />
              <input placeholder="Dirección" value={editingIssuer.direccion || ''} onChange={e => setEditingIssuer({ ...editingIssuer, direccion: e.target.value })} className="h-9 px-2 rounded border border-border bg-background text-sm col-span-2" />
              <input placeholder="Ciudad" value={editingIssuer.ciudad || ''} onChange={e => setEditingIssuer({ ...editingIssuer, ciudad: e.target.value })} className="h-9 px-2 rounded border border-border bg-background text-sm" />
              <input placeholder="Código postal" value={editingIssuer.cp || ''} onChange={e => setEditingIssuer({ ...editingIssuer, cp: e.target.value })} className="h-9 px-2 rounded border border-border bg-background text-sm" />
              <input placeholder="País" value={editingIssuer.pais || ''} onChange={e => setEditingIssuer({ ...editingIssuer, pais: e.target.value })} className="h-9 px-2 rounded border border-border bg-background text-sm" />
              <input placeholder="Email" value={editingIssuer.email || ''} onChange={e => setEditingIssuer({ ...editingIssuer, email: e.target.value })} className="h-9 px-2 rounded border border-border bg-background text-sm" />
              <input placeholder="Teléfono" value={editingIssuer.telefono || ''} onChange={e => setEditingIssuer({ ...editingIssuer, telefono: e.target.value })} className="h-9 px-2 rounded border border-border bg-background text-sm" />
              <input placeholder="IBAN" value={editingIssuer.iban || ''} onChange={e => setEditingIssuer({ ...editingIssuer, iban: e.target.value })} className="h-9 px-2 rounded border border-border bg-background text-sm" />
              <input placeholder="Logo (URL de la imagen)" value={editingIssuer.logo_url || ''} onChange={e => { setEditingIssuer({ ...editingIssuer, logo_url: e.target.value }); setLogoFile(null); }} className="h-9 px-2 rounded border border-border bg-background text-sm col-span-2" />
            </div>
            {/* Numeración propia de esta empresa emisora */}
            <div className="border-t border-border/60 pt-2 mt-1">
              <p className="text-[11px] font-semibold text-muted-foreground mb-1">Numeración de facturas de esta empresa</p>
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Serie (ej: A, FAC, 2026)" value={editingIssuer.serie || ''} maxLength={10} onChange={e => setEditingIssuer({ ...editingIssuer, serie: e.target.value })} className="h-9 px-2 rounded border border-border bg-background text-sm" />
                <input placeholder="Nº desde el que arranca (último emitido)" type="number" min={0} value={issuerNumInicial} onChange={e => setIssuerNumInicial(e.target.value)} className="h-9 px-2 rounded border border-border bg-background text-sm" />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Cada empresa lleva su propia serie/correlativo. Ej: si en tu sistema anterior ibas por la <b>200</b>, poné serie <code className="px-1 bg-muted rounded">A</code> y número <code className="px-1 bg-muted rounded">200</code> → la próxima será <code className="px-1 bg-muted rounded">A 0201</code>. Los abonos usan serie <code className="px-1 bg-muted rounded">R{(editingIssuer.serie || 'A').trim() || 'A'}</code>.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm cursor-pointer hover:bg-muted">
                Subir logo del servidor
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                  onChange={e => { const f = e.target.files?.[0] || null; setLogoFile(f); }} />
              </label>
              <span className="text-xs text-muted-foreground">{logoFile ? `Archivo: ${logoFile.name}` : 'O pegá una URL arriba'}</span>
              {(logoFile || editingIssuer.logo_url) && (
                <img
                  src={logoFile ? URL.createObjectURL(logoFile) : (editingIssuer.logo_url as string)}
                  alt="logo"
                  className="h-10 max-w-[160px] object-contain border border-border rounded bg-white"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
            </div>
            <textarea placeholder="Pie de página por defecto (instrucciones de pago, etc.)" value={editingIssuer.pie_default || ''} onChange={e => setEditingIssuer({ ...editingIssuer, pie_default: e.target.value })} rows={2} className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm" />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!editingIssuer.es_default} onChange={e => setEditingIssuer({ ...editingIssuer, es_default: e.target.checked })} />
              Empresa por defecto (se preselecciona al facturar)
            </label>
            <div className="flex gap-2">
              <button onClick={saveIssuer} disabled={uploadingLogo} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">{uploadingLogo ? 'Subiendo logo…' : 'Guardar'}</button>
              <button onClick={() => { setEditingIssuer(null); setLogoFile(null); }} className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted">Cancelar</button>
            </div>
          </div>
        )}
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
