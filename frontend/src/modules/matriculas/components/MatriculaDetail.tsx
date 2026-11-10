import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client, { API_BASE_URL } from '@/shared/api/client';
import Portal from '@/shared/components/ui/portal';
import { toast } from '@/shared/hooks/useToast';
import { CheckCircle, XCircle, Upload, X, Copy, FilePdf, ArrowSquareOut } from '@phosphor-icons/react';
import { ESTADO_LABEL, ESTADO_COLOR, enHoraDeMadrid } from '../lib/estados';

/**
 * La ficha de una matrícula (#199), «en un panel lateral como la de los
 * prospectos» (ideas de Diego, 01/10):
 *   - cabecera: el nombre, la etiqueta de estado, el curso y el campus;
 *   - datos de la persona, con botón para copiar;
 *   - documentos en miniatura, con visor grande (o de PDF) y «Reemplazar»;
 *   - vínculos: su prospecto, su venta y su gestora;
 *   - historial;
 *   - acciones según el estado.
 *
 * Los datos de la persona salen del formulario (`datos_admision`, con los
 * nombres del contrato de la #198) mientras el webhook no los guarde en campos
 * propios.
 */

interface Matricula {
  id: number;
  estado?: string;
  lead_id?: number | null;
  conversion_id?: number | null;
  lead_nombre?: string;
  lead_email?: string;
  lead_telefono?: string;
  curso?: string;
  campus_nombre?: string;
  gestora_nombre?: string;
  recibida_at?: string;
  source?: string;
  validated_at?: string;
  validated_by_nombre?: string;
  dni?: string;
  titulo?: string;
  notas?: string;
  motivo_rechazo?: string;
  dni_doc_url?: string;
  titulo_doc_url?: string;
  firma_url?: string;
  documentos_formato?: Record<string, 'pdf' | 'imagen'>;
  datos_admision?: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface Props {
  matricula: Matricula;
  onClose: () => void;
  onChange: () => void;
  // Sin permiso para editar no llega: la botonera entera desaparece.
  onEstado?: (m: Matricula, estado: string) => void;
  /** Hay otra ventana encima (la de «Rechazar»): Esc es suyo, no de la ficha. */
  pausada?: boolean;
}

/**
 * Los documentos, en el orden de Diego: «DNI por las dos caras, foto, título,
 * firma». `tipo` es el de la ruta del servidor (el DNI de detrás y la foto,
 * desde la migración 212).
 */
const DOCUMENTOS: Array<{ clave: string; nombre: string; tipo: string; campo: string }> = [
  { clave: 'dni_frente', nombre: 'DNI (delante)', tipo: 'dni', campo: 'dni_doc_url' },
  { clave: 'dni_dorso', nombre: 'DNI (detrás)', tipo: 'dni_dorso', campo: 'dni_dorso_url' },
  { clave: 'foto', nombre: 'Foto', tipo: 'foto', campo: 'foto_url' },
  { clave: 'titulo', nombre: 'Título', tipo: 'titulo', campo: 'titulo_doc_url' },
  { clave: 'firma', nombre: 'Firma', tipo: 'firma', campo: 'firma_url' },
];
const NOMBRE_DOC: Record<string, string> = Object.fromEntries(DOCUMENTOS.map((d) => [d.tipo, d.nombre]));

interface Evento {
  evento: 'recibida' | 'creada' | 'estado' | 'documento';
  estado?: string | null;
  motivo?: string | null;
  documento?: string | null;
  reemplazo?: boolean;
  usuario?: string | null;
  creado_at: string;
}

/**
 * Una línea del historial, como en las ideas de Diego: «Recibida por el
 * formulario el 01/10 a las 09:12», «Datos validados por Mireia el 01/10 a las
 * 11:40»…
 */
function lineaDelHistorial(e: Evento): string {
  const quien = e.usuario ? ` por ${e.usuario}` : '';
  const cuando = ` el ${enHoraDeMadrid(e.creado_at)}`;
  if (e.evento === 'recibida') return `Recibida por el formulario${cuando}`;
  if (e.evento === 'creada') return `Creada a mano${quien}${cuando}`;
  if (e.evento === 'documento') {
    const doc = NOMBRE_DOC[e.documento || ''] || 'Documento';
    // «Foto subida», «Firma reemplazada»; «DNI subido», «Título reemplazado».
    const femenino = e.documento === 'foto' || e.documento === 'firma';
    const hecho = e.reemplazo ? (femenino ? 'reemplazada' : 'reemplazado') : (femenino ? 'subida' : 'subido');
    return `${doc} ${hecho}${quien}${cuando}`;
  }
  const estado = ESTADO_LABEL[e.estado || ''] || e.estado || 'Cambio de estado';
  return `${estado}${quien}${cuando}${e.motivo ? `. Motivo: ${e.motivo}` : ''}`;
}

// La firma se guarda con el fondo transparente (para el diploma) y su trazo es de
// tinta oscura: sobre el modo oscuro no se veía. Va sobre «papel» blanco siempre.
const FONDO_FIRMA = 'bg-white';

const CAMPO = 'mt-1 w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

/**
 * La dirección de un documento, completa. El servidor la da como
 * `/api/matriculas/1/doc/dni?…`, pero el CRM vive en `/crm/` y su API en
 * `/crm/api`: sin completarla, el navegador la pedía fuera del CRM (404) y la
 * ficha decía «No se pudo abrir» con el documento ahí. Como `urlDelArchivo` de
 * las facturas de colaboradores.
 */
const urlDelDocumento = (url: string) => (url.startsWith('/api/') ? `${API_BASE_URL}${url.slice(4)}` : url);

/**
 * Lo que trae el formulario, como texto (vacío si no viene). Primero el campo
 * propio de la matrícula (#198: el webhook guarda ahí lo ya mapeado, aunque el
 * formulario lo llame de otra forma) y, si no, el envío tal como llegó.
 */
const delFormulario = (m: Matricula, clave: string) => {
  const propio = m[clave];
  const v = propio !== undefined && propio !== null && propio !== '' ? propio : m.datos_admision?.[clave];
  return v === undefined || v === null ? '' : String(v);
};

/** El artículo de cada documento, para el aviso: «el DNI (delante)», «el título», «la foto»… */
const conArticulo = (nombre: string) => {
  if (nombre.startsWith('DNI')) return `el ${nombre}`;
  return /^(Foto|Firma)/.test(nombre) ? `la ${nombre.toLowerCase()}` : `el ${nombre.toLowerCase()}`;
};

export default function MatriculaDetail({ matricula, onClose, onChange, onEstado, pausada = false }: Props) {
  const [m, setM] = useState<Matricula>(matricula);
  // Si ya se ha escrito en «A mano», lo que llegue del servidor no lo pisa.
  const tocado = useRef(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [visor, setVisor] = useState<{ nombre: string; url: string; formato: 'pdf' | 'imagen'; tipo: string } | null>(null);
  const [fallidos, setFallidos] = useState<Record<string, boolean>>({});

  /** La ficha completa (gestora, historial y enlaces firmados recién hechos), sin pisar lo escrito a mano. */
  const conservarLoEscrito = (nueva: Matricula) => setM((antes) => (tocado.current
    ? { ...nueva, dni: antes.dni, titulo: antes.titulo, notas: antes.notas }
    : nueva));
  async function recargar(): Promise<Matricula | null> {
    try {
      const res = await client.get(`/matriculas/${matricula.id}`);
      if (res?.success && (res.data as Matricula)?.id) { conservarLoEscrito(res.data as Matricula); return res.data as Matricula; }
    } catch { /* se queda con lo que hay */ }
    return null;
  }

  // Al abrirla.
  useEffect(() => {
    let vivo = true;
    client.get(`/matriculas/${matricula.id}`)
      .then((res) => { if (vivo && res?.success && (res.data as Matricula)?.id) conservarLoEscrito(res.data as Matricula); })
      .catch(() => { /* se queda con la de la lista */ });
    return () => { vivo = false; };
  }, [matricula.id]);

  /**
   * El visor, siempre con un enlace recién firmado: los enlaces duran 15
   * minutos, y con la ficha abierta más tiempo el de la miniatura ya no vale.
   */
  async function abrirVisor(nombre: string, tipo: string, campo: string) {
    const fresca = await recargar();
    const guardada = ((fresca || m)[campo] as string | undefined) || '';
    if (!guardada) return;
    const formato = (fresca || m).documentos_formato?.[tipo] === 'pdf' ? 'pdf' : 'imagen';
    setVisor({ nombre, url: urlDelDocumento(guardada), formato, tipo });
  }

  /** «Vuelve a intentarlo»: enlaces nuevos y el documento, otra vez. */
  async function reintentar(tipo: string) {
    await recargar();
    setFallidos((f) => ({ ...f, [tipo]: false }));
  }

  // Cerrar con Esc (primero el visor, si está abierto).
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || pausada) return;
      if (visor) setVisor(null); else onClose();
    };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [visor, onClose, pausada]);

  async function handleUpload(tipo: string, file?: File) {
    if (!file) return;
    setUploading(tipo);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await client.post(`/matriculas/${m.id}/doc/${tipo}`, fd);
      if (res.success) {
        setM(res.data as Matricula);
        setFallidos((f) => ({ ...f, [tipo]: false }));
        toast({ title: 'Documento subido' });
        onChange();
      }
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
    finally { setUploading(null); }
  }

  async function handleSaveCampos() {
    try {
      const res = await client.patch(`/matriculas/${m.id}`, { dni: m.dni || null, titulo: m.titulo || null, notas: m.notas || null });
      if (res.success) { tocado.current = false; setM(res.data as Matricula); toast({ title: 'Guardado' }); onChange(); }
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }

  const copiar = async (texto: string, que: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast({ title: `${que} copiado` });
    } catch { toast({ title: 'No se pudo copiar', variant: 'destructive' }); }
  };

  const documento = [delFormulario(m, 'documento_tipo'), delFormulario(m, 'documento') || m.dni].filter(Boolean).join(' ');
  const nacimiento = delFormulario(m, 'fecha_nacimiento');
  const datos: Array<{ etiqueta: string; valor: string }> = [
    { etiqueta: 'Documento', valor: documento },
    // La del campo propio llega como «1990-05-17» o «1990-05-17T00:00:00.000Z»: vale el día.
    { etiqueta: 'Fecha de nacimiento', valor: /^\d{4}-\d{2}-\d{2}/.test(nacimiento) ? nacimiento.slice(0, 10).split('-').reverse().join('/') : nacimiento },
    // El país, en su fila: junto a la dirección, sin dirección salía «Dirección: España» (#198, prueba a mano).
    { etiqueta: 'Dirección', valor: delFormulario(m, 'direccion') },
    { etiqueta: 'País', valor: delFormulario(m, 'pais') },
    { etiqueta: 'Estudios', valor: delFormulario(m, 'estudios') },
    { etiqueta: 'Correo', valor: m.lead_email || delFormulario(m, 'email') },
    { etiqueta: 'Teléfono', valor: m.lead_telefono || delFormulario(m, 'telefono') },
  ];

  // El historial: cada cosa que le ha pasado, con quién y cuándo (lo guarda el
  // servidor en matriculas_eventos, migración 212).
  const historial = (Array.isArray(m.historial) ? (m.historial as Evento[]) : []).map(lineaDelHistorial);

  return (
    <Portal>
      <div role="dialog" aria-modal="true" aria-labelledby="matricula-detail-title" className="fixed inset-0 z-[60]">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose} />

        <aside className="absolute top-0 right-0 h-full w-full max-w-[480px] bg-card border-l border-border shadow-dialog flex flex-col animate-in slide-in-from-right duration-200">
          {/* Cabecera: nombre, estado, curso y campus. */}
          <header className="flex items-start justify-between gap-3 p-5 border-b border-border">
            <div className="min-w-0 space-y-1">
              <h2 id="matricula-detail-title" className="font-semibold text-base truncate">{m.lead_nombre || 'Matrícula'}</h2>
              {m.estado && (
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${ESTADO_COLOR[m.estado] || ''}`}>
                  {ESTADO_LABEL[m.estado] || m.estado}
                </span>
              )}
              <p className="text-xs text-muted-foreground truncate">{[m.curso, m.campus_nombre].filter(Boolean).join(' · ') || '—'}</p>
            </div>
            <button onClick={onClose} aria-label="Cerrar detalle"
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/40">
              <X size={18} weight="bold" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {m.estado === 'rechazada' && m.motivo_rechazo && (
              <div className="p-3 bg-destructive-soft rounded-lg text-xs text-destructive-soft-foreground"><strong>Motivo del rechazo:</strong> {m.motivo_rechazo}</div>
            )}

            {/* Datos de la persona, con botón para copiar. */}
            <section aria-label="Datos de la persona">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Datos de la persona</h3>
              <dl className="divide-y divide-border rounded-lg border border-border">
                {datos.map(({ etiqueta, valor }) => (
                  <div key={etiqueta} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <dt className="text-[11px] text-muted-foreground">{etiqueta}</dt>
                      {/* «No indicado» y no «—»: la raya casi no se veía y parecía que el dato de debajo era el suyo (#198, prueba a mano). */}
                      <dd className="text-sm truncate">{valor || <span className="text-muted-foreground italic">No indicado</span>}</dd>
                    </div>
                    {valor && (
                      <button type="button" onClick={() => copiar(valor, etiqueta)} aria-label={`Copiar ${etiqueta.toLowerCase()}`}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0">
                        <Copy size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </dl>
            </section>

            {/* Documentos: miniaturas, visor y «Reemplazar». */}
            <section aria-label="Documentos">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Documentos</h3>
              <div className="grid grid-cols-2 gap-3">
                {DOCUMENTOS.map(({ clave, nombre, tipo, campo }) => {
                  const guardada = m[campo] as string | undefined;
                  const url = guardada ? urlDelDocumento(guardada) : undefined;
                  const formato = m.documentos_formato?.[tipo];
                  const fallo = fallidos[tipo];
                  return (
                    <div key={clave} className="border border-border rounded-xl p-2.5 space-y-2">
                      <p className="text-[11px] font-bold uppercase text-muted-foreground">{nombre}</p>
                      {url && !fallo ? (
                        <button type="button" onClick={() => abrirVisor(nombre, tipo, campo)}
                          aria-label={`Ver ${nombre}`}
                          className={`block w-full h-24 rounded-lg overflow-hidden ${tipo === 'firma' ? FONDO_FIRMA : 'bg-muted/40'} hover:ring-2 hover:ring-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40`}>
                          {formato === 'pdf' ? (
                            <span className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground text-xs"><FilePdf size={28} />PDF</span>
                          ) : (
                            <img src={url} alt={nombre} className={`h-full w-full ${tipo === 'firma' ? 'object-contain p-1' : 'object-cover'}`}
                              onError={() => setFallidos((f) => ({ ...f, [tipo]: true }))} />
                          )}
                        </button>
                      ) : fallo ? (
                        <div className="space-y-1.5">
                          <p className="text-xs text-destructive">No se pudo abrir {conArticulo(nombre)}. Vuelve a intentarlo; si sigue, súbelo de nuevo.</p>
                          <button type="button" onClick={() => reintentar(tipo)}
                            className="w-full px-2 py-1 rounded border border-border text-[11px] font-bold hover:bg-muted">
                            Reintentar
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Falta</p>
                      )}
                      <label className="block cursor-pointer">
                        <input type="file" className="hidden" accept="image/*,application/pdf" aria-label={`Subir ${nombre}`}
                          onChange={(e) => {
                            handleUpload(tipo, e.target.files?.[0]);
                            // Vacía la casilla: si no, volver a elegir el mismo archivo (tras un error) no hacía nada.
                            e.target.value = '';
                          }} />
                        <span className="flex items-center justify-center gap-1 px-2 py-1 rounded bg-muted text-[11px] font-bold hover:bg-muted/70">
                          <Upload size={12} /> {uploading === tipo ? 'Subiendo…' : url ? 'Reemplazar' : 'Subir'}
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Vínculos: su prospecto, su venta y su gestora. */}
            <section aria-label="Vínculos">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Vínculos</h3>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-[11px] text-muted-foreground">Prospecto</dt>
                  <dd>{m.lead_id ? <Link to={`/leads/${m.lead_id}`} className="text-primary hover:underline inline-flex items-center gap-1">Ver prospecto <ArrowSquareOut size={12} /></Link> : <span className="text-muted-foreground">Sin prospecto</span>}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Venta</dt>
                  <dd>{m.conversion_id ? <Link to={`/ventas/${m.conversion_id}`} className="text-primary hover:underline inline-flex items-center gap-1">Ver venta <ArrowSquareOut size={12} /></Link> : <span className="text-muted-foreground">Sin venta</span>}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Gestora</dt>
                  <dd className="truncate">{m.gestora_nombre || <span className="text-muted-foreground">Sin gestora</span>}</dd></div>
              </dl>
            </section>

            {/* Historial. */}
            <section aria-label="Historial">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Historial</h3>
              {historial.length ? (
                <ol className="space-y-1.5 text-sm">
                  {historial.map((h, i) => <li key={i} className="pl-3 border-l-2 border-border">{h}</li>)}
                </ol>
              ) : <p className="text-sm text-muted-foreground">Sin movimientos.</p>}
            </section>

            {/* Lo que se apunta a mano (ya estaba en la ficha). */}
            <section aria-label="Datos a mano" className="space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">A mano</h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">
                  <span className="font-bold uppercase text-muted-foreground">DNI</span>
                  <input value={m.dni || ''} onChange={e => { tocado.current = true; setM({ ...m, dni: e.target.value }); }} className={CAMPO} />
                </label>
                <label className="block text-xs">
                  <span className="font-bold uppercase text-muted-foreground">Título</span>
                  <input value={m.titulo || ''} onChange={e => { tocado.current = true; setM({ ...m, titulo: e.target.value }); }} className={CAMPO} />
                </label>
              </div>
              <label className="block text-xs">
                <span className="font-bold uppercase text-muted-foreground">Notas</span>
                <textarea value={m.notas || ''} onChange={e => { tocado.current = true; setM({ ...m, notas: e.target.value }); }} rows={2}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </label>
              <button onClick={handleSaveCampos}
                className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/40">
                Guardar campos
              </button>
            </section>
          </div>

          {/* Las acciones de Diego (#199), según el estado: en Solicitud, «Validar
              datos»; en Datos validados o Pendiente, «Validar matrícula»; en
              cualquiera, «Rechazar», que pide el motivo. */}
          {onEstado && m.estado !== 'rechazada' && (
            <footer className="p-4 border-t border-border flex justify-end gap-2">
              {m.estado === 'solicitud_admision' && (
                <button onClick={() => onEstado(m, 'datos_validados')}
                  className="flex items-center gap-1 h-9 px-3 rounded-lg bg-success hover:bg-success text-success-foreground text-xs font-bold focus:outline-none focus:ring-2 focus:ring-success/40">
                  <CheckCircle size={14} weight="bold" /> Validar datos
                </button>
              )}
              {(m.estado === 'datos_validados' || m.estado === 'pendiente') && (
                <button onClick={() => onEstado(m, 'validada')}
                  className="flex items-center gap-1 h-9 px-3 rounded-lg bg-success hover:bg-success text-success-foreground text-xs font-bold focus:outline-none focus:ring-2 focus:ring-success/40">
                  <CheckCircle size={14} weight="bold" /> Validar matrícula
                </button>
              )}
              <button onClick={() => onEstado(m, 'rechazada')}
                className="flex items-center gap-1 h-9 px-3 rounded-lg bg-destructive hover:bg-destructive/90 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-destructive/40">
                <XCircle size={14} weight="bold" /> Rechazar
              </button>
            </footer>
          )}
        </aside>

        {/* El visor grande: la imagen, o el PDF en su visor. */}
        {visor && (
          <div role="dialog" aria-label={`Visor: ${visor.nombre}`} className="absolute inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={() => setVisor(null)}>
            <div className="relative w-full max-w-4xl h-[85vh] bg-card rounded-xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <p className="text-sm font-semibold">{visor.nombre}</p>
                <div className="flex items-center gap-2">
                  <a href={visor.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">Abrir aparte <ArrowSquareOut size={12} /></a>
                  <button onClick={() => setVisor(null)} aria-label="Cerrar visor" className="p-1.5 rounded hover:bg-muted"><X size={16} weight="bold" /></button>
                </div>
              </div>
              <div className={`flex-1 min-h-0 ${visor.tipo === 'firma' ? FONDO_FIRMA : 'bg-muted/30'} flex items-center justify-center`}>
                {visor.formato === 'pdf'
                  ? <iframe src={visor.url} title={visor.nombre} className="w-full h-full" />
                  : <img src={visor.url} alt={visor.nombre} className="max-h-full max-w-full object-contain" />}
              </div>
            </div>
          </div>
        )}
      </div>
    </Portal>
  );
}
