import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, FloppyDisk, Plus, Trash, TextAlignLeft, TextAlignCenter, TextAlignRight, TextB } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import { invoicesApi } from '../api/invoices.api';
import type { InvoiceTemplate, TemplateBlock, Issuer } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

// A4 @96dpi
const A4_W = 794;
const A4_H = 1123;

const BLOCK_LABELS: Record<TemplateBlock['type'], string> = {
  logo: 'Logo', emisor: 'Datos emisor', cliente: 'Datos cliente', meta: 'Nº / Fecha',
  items: 'Tabla de ítems', totales: 'Totales / IVA', pie: 'Pie de pago', texto: 'Texto libre',
};

const PALETTE: TemplateBlock['type'][] = ['logo', 'emisor', 'cliente', 'meta', 'items', 'totales', 'pie', 'texto'];

const uid = () => `b${Math.random().toString(36).slice(2, 9)}`;

function seedLayout(): TemplateBlock[] {
  return [
    { id: uid(), type: 'logo', x: 40, y: 40, w: 180, h: 70 },
    { id: uid(), type: 'emisor', x: 470, y: 40, w: 284, h: 100, align: 'right', fontSize: 11 },
    { id: uid(), type: 'meta', x: 470, y: 155, w: 284, h: 55, align: 'right', fontSize: 12, bold: true },
    { id: uid(), type: 'cliente', x: 40, y: 160, w: 380, h: 110, fontSize: 11 },
    { id: uid(), type: 'items', x: 40, y: 300, w: 714, h: 320, fontSize: 11 },
    { id: uid(), type: 'totales', x: 470, y: 640, w: 284, h: 120, align: 'right', fontSize: 12 },
    { id: uid(), type: 'pie', x: 40, y: 800, w: 714, h: 140, fontSize: 10, color: '#666666' },
  ];
}

// Contenido de ejemplo que muestra qué datos rellenará cada bloque.
function BlockPreview({ b }: { b: TemplateBlock }) {
  const style: React.CSSProperties = {
    fontSize: (b.fontSize || 12), textAlign: b.align || 'left',
    fontWeight: b.bold ? 700 : 400, color: b.color || '#111', width: '100%', height: '100%',
    overflow: 'hidden', lineHeight: 1.35,
  };
  switch (b.type) {
    case 'logo': return <div style={style} className="flex items-center justify-center border border-dashed border-slate-300 rounded bg-slate-50 text-slate-400">🖼 Logo</div>;
    case 'emisor': return <div style={style}><b>MI EMPRESA S.L.</b><br/>NIF: B12345678<br/>Calle Ejemplo 1, Madrid<br/>28001 · España</div>;
    case 'cliente': return <div style={style}><b>Cliente</b><br/>Nombre del cliente<br/>NIF: X0000000T<br/>Dirección fiscal</div>;
    case 'meta': return <div style={style}>FACTURA Nº 2026/0001<br/>Fecha: 30/06/2026</div>;
    case 'totales': return <div style={style}>Base imponible: 100,00 €<br/>IVA (21%): 21,00 €<br/><b>TOTAL: 121,00 €</b></div>;
    case 'pie': return <div style={style}>Forma de pago: transferencia<br/>IBAN ES00 0000 0000 0000<br/>Vencimiento: 30 días</div>;
    case 'texto': return <div style={style}>{b.text || 'Texto libre…'}</div>;
    case 'items': return (
      <div style={style}>
        <table className="w-full border-collapse" style={{ fontSize: b.fontSize || 11 }}>
          <thead><tr className="border-b border-slate-400 text-left">
            <th className="py-0.5">{b.cols?.desc || 'Descripción'}</th><th className="text-center">{b.cols?.cant || 'Cant.'}</th><th className="text-right">{b.cols?.precio || 'Precio'}</th><th className="text-right">{b.cols?.total || 'Total'}</th>
          </tr></thead>
          <tbody>
            <tr className="border-b border-slate-200"><td>Curso ejemplo</td><td className="text-center">1</td><td className="text-right">100,00</td><td className="text-right">100,00</td></tr>
            <tr className="border-b border-slate-200"><td>…</td><td className="text-center">—</td><td className="text-right">—</td><td className="text-right">—</td></tr>
          </tbody>
        </table>
      </div>
    );
    default: return <div style={style} />;
  }
}

export default function InvoiceTemplateEditorPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id?: number; nombre?: string } };
  const pid = activeProject?.id;
  const invBase = useLocation().pathname.split('/facturas')[0];
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [issuers, setIssuers] = useState<Issuer[]>([]);
  const [current, setCurrent] = useState<InvoiceTemplate | null>(null);
  const [layout, setLayout] = useState<TemplateBlock[]>([]);
  const [nombre, setNombre] = useState('Plantilla');
  const [issuerId, setIssuerId] = useState<number | null>(null);
  const [esDefault, setEsDefault] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);
  const dragRef = useRef<{ id: string; mode: 'move' | 'resize'; startX: number; startY: number; ox: number; oy: number; ow: number; oh: number } | null>(null);

  const load = useCallback(async () => {
    if (!pid) return;
    const [t, i] = await Promise.all([
      invoicesApi.listTemplates(pid),
      invoicesApi.listIssuers(pid).catch(() => ({ success: false, data: [] as Issuer[] })),
    ]);
    const tpls = t.success ? (t.data || []) : [];
    setTemplates(tpls);
    if (i.success) setIssuers(i.data || []);
    // Init una sola vez: abrir la default (o la primera), o empezar una nueva con diseño base.
    if (!initRef.current) {
      initRef.current = true;
      const def = tpls.find((x) => x.es_default) || tpls[0];
      if (def) editTemplate(def); else newTemplate();
    }
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  function newTemplate() {
    setCurrent(null); setNombre('Plantilla'); setIssuerId(null); setEsDefault(false);
    setLayout(seedLayout()); setSelectedId(null);
  }
  function editTemplate(t: InvoiceTemplate) {
    setCurrent(t); setNombre(t.nombre); setIssuerId(t.issuer_id); setEsDefault(t.es_default);
    setLayout(Array.isArray(t.layout) ? t.layout : []); setSelectedId(null);
  }

  const selected = layout.find((b) => b.id === selectedId) || null;
  const patch = (id: string, p: Partial<TemplateBlock>) => setLayout((l) => l.map((b) => b.id === id ? { ...b, ...p } : b));

  function addBlock(type: TemplateBlock['type']) {
    const b: TemplateBlock = { id: uid(), type, x: 60, y: 60, w: type === 'items' ? 700 : 240, h: type === 'items' ? 200 : 70, fontSize: 12, align: 'left' };
    setLayout((l) => [...l, b]); setSelectedId(b.id);
  }

  // Drag & resize con pointer events (coords en espacio A4).
  function onPointerDown(e: React.PointerEvent, id: string, mode: 'move' | 'resize') {
    e.stopPropagation();
    const b = layout.find((x) => x.id === id); if (!b) return;
    setSelectedId(id);
    dragRef.current = { id, mode, startX: e.clientX, startY: e.clientY, ox: b.x, oy: b.y, ow: b.w, oh: b.h };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current; if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (d.mode === 'move') {
      patch(d.id, { x: Math.max(0, Math.min(A4_W - 20, d.ox + dx)), y: Math.max(0, Math.min(A4_H - 20, d.oy + dy)) });
    } else {
      patch(d.id, { w: Math.max(40, d.ow + dx), h: Math.max(24, d.oh + dy) });
    }
  }
  function onPointerUp() { dragRef.current = null; }

  async function save() {
    if (!pid) return;
    setSaving(true);
    try {
      const body = { projectId: pid, issuerId: issuerId || null, nombre, pageSize: 'A4', layout, esDefault };
      const res = current
        ? await invoicesApi.updateTemplate(current.id, body)
        : await invoicesApi.createTemplate(body);
      if (res.success) {
        toast({ title: current ? '✓ Plantilla actualizada' : '✓ Plantilla creada' });
        if (res.data) setCurrent(res.data);
        await load();
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function removeTemplate(id: number) {
    if (!confirm('¿Eliminar esta plantilla?')) return;
    await invoicesApi.deleteTemplate(id);
    if (current?.id === id) newTemplate();
    await load();
    toast({ title: 'Plantilla eliminada' });
  }

  if (!pid) return <div className="p-8 text-muted-foreground">Selecciona un proyecto.</div>;

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Diseñador de facturas"
        subtitle={`Editor visual (Canva) — ${activeProject?.nombre || ''}`}
        actions={(
          <Link to={`${invBase}/facturas/configuracion`} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted">
            <ArrowLeft size={14} weight="bold" /> Volver
          </Link>
        )}
      />

      <div className="flex gap-4 items-start">
        {/* Panel izquierdo: plantillas + paleta + propiedades */}
        <div className="w-64 shrink-0 space-y-3">
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase text-muted-foreground">Plantillas</h3>
              <button onClick={newTemplate} className="inline-flex items-center gap-1 h-7 px-2 rounded bg-primary text-primary-foreground text-[11px] font-semibold"><Plus size={12} weight="bold"/>Nueva</button>
            </div>
            <div className="space-y-1">
              {templates.length === 0 && <p className="text-[11px] text-muted-foreground italic">Sin plantillas. Creá una nueva.</p>}
              {templates.map((t) => (
                <div key={t.id} className={`flex items-center justify-between rounded px-2 py-1 text-xs cursor-pointer ${current?.id === t.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}>
                  <button className="flex-1 text-left truncate" onClick={() => editTemplate(t)}>
                    {t.nombre}{t.es_default ? ' ★' : ''}<span className="block text-[9px] text-muted-foreground">{t.issuer_nombre || 'Todas las empresas'}</span>
                  </button>
                  <button onClick={() => removeTemplate(t.id)} className="text-red-500 hover:text-red-600"><Trash size={12}/></button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-3">
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-2">Añadir bloque</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {PALETTE.map((tp) => (
                <button key={tp} onClick={() => addBlock(tp)} className="h-8 px-2 rounded border border-border text-[11px] hover:bg-muted text-left truncate">{BLOCK_LABELS[tp]}</button>
              ))}
            </div>
          </div>

          {selected && (
            <div className="bg-card border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase text-muted-foreground">{BLOCK_LABELS[selected.type]}</h3>
                <button onClick={() => { setLayout((l) => l.filter((b) => b.id !== selected.id)); setSelectedId(null); }} className="text-red-500 text-[11px] inline-flex items-center gap-1"><Trash size={12}/>Quitar</button>
              </div>
              <label className="block text-[11px]">Tamaño de fuente
                <input type="number" min={6} max={48} value={selected.fontSize || 12} onChange={(e) => patch(selected.id, { fontSize: Number(e.target.value) })} className="w-full h-8 px-2 mt-0.5 rounded border border-border bg-background text-sm" />
              </label>
              <div className="flex gap-1">
                {(['left','center','right'] as const).map((a) => {
                  const Icon = a === 'left' ? TextAlignLeft : a === 'center' ? TextAlignCenter : TextAlignRight;
                  return <button key={a} onClick={() => patch(selected.id, { align: a })} className={`h-8 w-8 rounded border flex items-center justify-center ${selected.align === a ? 'bg-primary/10 border-primary text-primary' : 'border-border'}`}><Icon size={14}/></button>;
                })}
                <button onClick={() => patch(selected.id, { bold: !selected.bold })} className={`h-8 w-8 rounded border flex items-center justify-center ${selected.bold ? 'bg-primary/10 border-primary text-primary' : 'border-border'}`}><TextB size={14}/></button>
                <input type="color" value={selected.color || '#111111'} onChange={(e) => patch(selected.id, { color: e.target.value })} className="h-8 w-8 rounded border border-border p-0.5" title="Color" />
              </div>
              {selected.type === 'texto' && (
                <textarea value={selected.text || ''} onChange={(e) => patch(selected.id, { text: e.target.value })} rows={3} placeholder="Texto…" className="w-full px-2 py-1 rounded border border-border bg-background text-sm" />
              )}
              {selected.type === 'items' && (
                <div className="space-y-1.5 border-t border-border/60 pt-2">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Encabezados de columna</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input value={selected.cols?.desc ?? ''} onChange={(e) => patch(selected.id, { cols: { ...selected.cols, desc: e.target.value } })} placeholder="Descripción" className="h-8 px-2 rounded border border-border bg-background text-xs" />
                    <input value={selected.cols?.cant ?? ''} onChange={(e) => patch(selected.id, { cols: { ...selected.cols, cant: e.target.value } })} placeholder="Cant." className="h-8 px-2 rounded border border-border bg-background text-xs" />
                    <input value={selected.cols?.precio ?? ''} onChange={(e) => patch(selected.id, { cols: { ...selected.cols, precio: e.target.value } })} placeholder="Precio" className="h-8 px-2 rounded border border-border bg-background text-xs" />
                    <input value={selected.cols?.total ?? ''} onChange={(e) => patch(selected.id, { cols: { ...selected.cols, total: e.target.value } })} placeholder="Total" className="h-8 px-2 rounded border border-border bg-background text-xs" />
                  </div>
                  <p className="text-[10px] text-muted-foreground">Dejá vacío para el nombre por defecto (ej. escribí "Precio unitario").</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Lienzo A4 */}
        <div className="flex-1 min-w-0 overflow-auto">
          <div className="mb-3 flex flex-wrap items-center gap-2 bg-card border border-border rounded-lg p-3">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la plantilla" className="h-9 px-2 rounded border border-border bg-background text-sm w-48" />
            <select value={issuerId ?? ''} onChange={(e) => setIssuerId(e.target.value ? Number(e.target.value) : null)} className="h-9 px-2 rounded border border-border bg-card text-sm">
              <option value="">Todas las empresas</option>
              {issuers.map((i) => <option key={i.id} value={i.id}>{i.razon_social}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={esDefault} onChange={(e) => setEsDefault(e.target.checked)} /> Por defecto</label>
            <button onClick={save} disabled={saving} className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              <FloppyDisk size={14} weight="bold" /> {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>

          <div className="inline-block shadow-lg">
            <div
              ref={canvasRef}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={() => setSelectedId(null)}
              className="relative bg-white"
              style={{ width: A4_W, height: A4_H }}
            >
              {layout.map((b) => (
                <div
                  key={b.id}
                  onPointerDown={(e) => onPointerDown(e, b.id, 'move')}
                  onClick={(e) => { e.stopPropagation(); setSelectedId(b.id); }}
                  className={`absolute cursor-move ${selectedId === b.id ? 'ring-2 ring-primary' : 'ring-1 ring-slate-200 hover:ring-slate-300'}`}
                  style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                >
                  <BlockPreview b={b} />
                  {selectedId === b.id && (
                    <div
                      onPointerDown={(e) => onPointerDown(e, b.id, 'resize')}
                      className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-primary rounded-sm cursor-se-resize"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">Arrastrá los bloques para moverlos · esquina inferior derecha para redimensionar · A4 (210×297mm). Los datos de ejemplo se reemplazan por los reales al emitir.</p>
        </div>
      </div>
    </div>
  );
}
