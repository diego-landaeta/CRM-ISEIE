import { useState, useRef, useMemo } from 'react';
import { X, FileCsv, UploadSimple, CheckCircle, Warning, ArrowsClockwise } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

export interface CsvImportDialogProps {
  open: boolean;
  onClose: () => void;
  projectId?: number | null;
  onImported?: () => void;
}

interface ParsedRow {
  nombre: string;
  email: string;
  telefono?: string;
  producto_interes?: string;
  canal?: string;
  notas?: string;
  _errors: string[];
}

// Parser CSV minimo: separador `,` o `;`, comillas dobles para escapar.
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const sep = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';
  const splitLine = (l: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (inQ && l[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === sep && !inQ) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = splitLine(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map(splitLine);
  return { headers, rows };
}

const HEADER_ALIASES: Record<string, string> = {
  nombre: 'nombre', name: 'nombre', full_name: 'nombre', 'full name': 'nombre',
  email: 'email', correo: 'email', mail: 'email', 'e-mail': 'email',
  telefono: 'telefono', 'teléfono': 'telefono', phone: 'telefono', 'móvil': 'telefono', movil: 'telefono', celular: 'telefono',
  producto: 'producto_interes', producto_interes: 'producto_interes', 'producto interés': 'producto_interes', curso: 'producto_interes',
  canal: 'canal', source: 'canal', origen: 'canal',
  notas: 'notas', notes: 'notas', observaciones: 'notas', comentarios: 'notas',
};

const VALID_CANALES = ['meta_ads', 'google_ads', 'tiktok_ads', 'organico', 'chatgpt_ia', 'directo', 'referido', 'whatsapp'];

function mapRow(headers: string[], values: string[]): ParsedRow {
  const obj: Record<string, string> = {};
  headers.forEach((h, i) => {
    const target = HEADER_ALIASES[h] || h;
    if (values[i] != null) obj[target] = values[i].replace(/^"|"$/g, '').trim();
  });
  const errors: string[] = [];
  if (!obj.nombre) errors.push('Falta nombre');
  if (!obj.email) errors.push('Falta email');
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(obj.email)) errors.push('Email inválido');
  if (obj.canal && !VALID_CANALES.includes(obj.canal)) obj.canal = 'directo';
  return {
    nombre: obj.nombre || '',
    email: (obj.email || '').toLowerCase(),
    telefono: obj.telefono || '',
    producto_interes: obj.producto_interes || '',
    canal: obj.canal || 'directo',
    notas: obj.notas || '',
    _errors: errors,
  };
}

const SAMPLE_CSV = `nombre,email,telefono,producto_interes,canal,notas
María García,maria@example.com,+34 600 111 222,Máster en Psicopedagogía,directo,Vino por anuncio Instagram
Diego López,diego@example.com,+34 600 222 333,Diplomado en Coaching,referido,Recomendado por Lucía Sánchez`;

export default function CsvImportDialog({ open, onClose, projectId, onImported }: CsvImportDialogProps) {
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: number; fail: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { headers, rows } = useMemo(() => rawText ? parseCsv(rawText) : { headers: [], rows: [] }, [rawText]);
  const parsed: ParsedRow[] = useMemo(() => rows.map((r) => mapRow(headers, r)), [headers, rows]);
  const valid = parsed.filter((r) => r._errors.length === 0);
  const invalid = parsed.filter((r) => r._errors.length > 0);

  if (!open) return null;

  function handleFile(file: File | undefined | null) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      toast({ title: 'Archivo inválido', description: 'Solo .csv', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Archivo muy grande', description: 'Máximo 5 MB', variant: 'destructive' });
      return;
    }
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => setRawText(String(e.target?.result || ''));
    reader.readAsText(file, 'utf-8');
  }

  function reset() {
    setFileName('');
    setRawText('');
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleSubmit() {
    if (!projectId) {
      toast({ title: 'Selecciona un proyecto', variant: 'destructive' });
      return;
    }
    if (valid.length === 0) {
      toast({ title: 'Sin filas válidas para importar', variant: 'destructive' });
      return;
    }
    if (valid.length > 500) {
      toast({ title: 'Máximo 500 filas por import', description: 'Divide el archivo en bloques.', variant: 'destructive' });
      return;
    }
    setImporting(true);
    try {
      const res: any = await client.post('/leads/bulk', {
        projectId,
        leads: valid.map(({ _errors, ...rest }) => rest),
      });
      const data = res?.data || res || {};
      const ok = data.ok ?? data.created?.length ?? valid.length;
      const fail = data.fail ?? 0;
      setResult({ ok, fail });
      toast({ title: `Importados ${ok} prospectos`, description: fail > 0 ? `${fail} fila(s) con error` : '' });
      if (onImported) onImported();
    } catch (err: any) {
      toast({ title: 'Error al importar', description: err?.message || 'Error', variant: 'destructive' });
    } finally { setImporting(false); }
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'plantilla-leads-iseie.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !importing && onClose()}>
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-lg flex items-center gap-2"><FileCsv size={20} weight="duotone" className="text-primary" /> Importar prospectos desde CSV</h2>
            <p className="text-xs text-muted-foreground mt-1">Columnas reconocidas: nombre, email, telefono, producto_interes, canal, notas.</p>
          </div>
          <button onClick={() => !importing && onClose()} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!rawText ? (
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
              className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary/40 transition-colors"
            >
              <UploadSimple size={32} weight="duotone" className="mx-auto text-muted-foreground mb-3" />
              <div className="font-semibold text-sm">Arrastra tu CSV aquí o haz clic</div>
              <div className="text-xs text-muted-foreground mt-1">UTF-8 · separador "," o ";" · máx 5 MB · 500 filas</div>
              <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); downloadSample(); }}
                className="mt-4 text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                Descargar plantilla de ejemplo
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-muted/40">
                <div className="flex items-center gap-2 text-sm min-w-0">
                  <FileCsv size={15} weight="duotone" className="text-primary flex-shrink-0" />
                  <span className="font-medium truncate">{fileName || 'archivo.csv'}</span>
                  <span className="text-xs text-muted-foreground">· {parsed.length} fila{parsed.length === 1 ? '' : 's'}</span>
                </div>
                <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <ArrowsClockwise size={11} /> Cambiar
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2 text-xs">
                  <div className="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5"><CheckCircle size={12} weight="fill" />{valid.length} válidas</div>
                </div>
                <div className={`rounded-lg border px-3 py-2 text-xs ${invalid.length > 0 ? 'border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20' : 'border-border bg-muted/30'}`}>
                  <div className={`font-bold flex items-center gap-1.5 ${invalid.length > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'}`}>
                    <Warning size={12} weight="fill" />{invalid.length} con error
                  </div>
                </div>
              </div>

              {parsed.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="px-3 py-2 bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Vista previa (primeras 8 filas)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-bold w-6">#</th>
                          <th className="px-2 py-1.5 text-left font-bold">Nombre</th>
                          <th className="px-2 py-1.5 text-left font-bold">Email</th>
                          <th className="px-2 py-1.5 text-left font-bold">Teléfono</th>
                          <th className="px-2 py-1.5 text-left font-bold">Producto</th>
                          <th className="px-2 py-1.5 text-left font-bold">Canal</th>
                          <th className="px-2 py-1.5 text-left font-bold">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.slice(0, 8).map((r, i) => (
                          <tr key={i} className={`border-t border-border ${r._errors.length ? 'bg-rose-50/30 dark:bg-rose-950/10' : ''}`}>
                            <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                            <td className="px-2 py-1.5 truncate max-w-[140px]">{r.nombre || '—'}</td>
                            <td className="px-2 py-1.5 truncate max-w-[180px]">{r.email || '—'}</td>
                            <td className="px-2 py-1.5 truncate max-w-[120px]">{r.telefono || '—'}</td>
                            <td className="px-2 py-1.5 truncate max-w-[140px]">{r.producto_interes || '—'}</td>
                            <td className="px-2 py-1.5">{r.canal || '—'}</td>
                            <td className="px-2 py-1.5">
                              {r._errors.length === 0
                                ? <span className="text-emerald-700 dark:text-emerald-300">OK</span>
                                : <span className="text-rose-700 dark:text-rose-300" title={r._errors.join(', ')}>{r._errors[0]}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle size={14} weight="fill" />
                  Importación completa: <strong>{result.ok}</strong> creados{result.fail > 0 ? `, ${result.fail} con error` : ''}.
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            type="button"
            onClick={() => !importing && onClose()}
            className="h-9 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            {result ? 'Cerrar' : 'Cancelar'}
          </button>
          {!result && rawText && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={importing || valid.length === 0}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {importing ? 'Importando…' : `Importar ${valid.length} prospecto${valid.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
