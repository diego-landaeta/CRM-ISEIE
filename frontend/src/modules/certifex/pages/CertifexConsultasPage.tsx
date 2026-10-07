import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, Buildings, ChatText, SealCheck, X } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Button } from '@/shared/components/ui/button';
import { certifexApi, type ConsultaCertifex, type EstadoConsulta } from '../api/certifex.api';

/**
 * Certifex · Consultas: lo que la gente escribe desde la web de Certifex.
 *
 * Un centro que quiere inscribir su campus, o cualquier otra consulta. En Certifex el
 * formulario abría el correo del visitante hacia una dirección vacía y no llegaba
 * nada a nadie; ahora Certifex la guarda, la atiende en su Soporte y la reenvía aquí.
 * El aviso sale por la campana (tipo `certifex_consulta`), no por correo.
 *
 * Se responde a la persona por correo, a mano. Aquí se lleva el estado y una nota
 * interna. El estado de aquí y el del Soporte de Certifex son independientes: cada
 * equipo lleva el suyo.
 */
const PESTANAS: { clave: 'todas' | EstadoConsulta; rotulo: string }[] = [
  { clave: 'nueva', rotulo: 'Nuevas' },
  { clave: 'en_curso', rotulo: 'En curso' },
  { clave: 'resuelta', rotulo: 'Resueltas' },
  { clave: 'todas', rotulo: 'Todas' },
];

const ESTADO: Record<EstadoConsulta, { rotulo: string; color: string }> = {
  nueva: { rotulo: 'Nueva', color: 'text-sky-600 dark:text-sky-400' },
  en_curso: { rotulo: 'En curso', color: 'text-amber-600 dark:text-amber-400' },
  resuelta: { rotulo: 'Resuelta', color: 'text-emerald-600 dark:text-emerald-400' },
  spam: { rotulo: 'Spam', color: 'text-red-600 dark:text-red-400' },
};

const cuando = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** `embebida`: dentro de Matrículas → Certificaciones, sin el título de página. */
export default function CertifexConsultasPage({ embebida = false }: { embebida?: boolean } = {}) {
  const [pestana, setPestana] = useState<'todas' | EstadoConsulta>('nueva');
  const [filas, setFilas] = useState<ConsultaCertifex[]>([]);
  const [total, setTotal] = useState(0);
  const [nuevas, setNuevas] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [abierta, setAbierta] = useState<ConsultaCertifex | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await certifexApi.listar(pestana === 'todas' ? {} : { estado: pestana });
      if (r.success) {
        setFilas(r.data.filas);
        setTotal(r.data.total);
        setNuevas(r.data.nuevas);
      }
    } finally { setCargando(false); }
  }, [pestana]);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="space-y-4">
      {!embebida && <PageHeader
        title="Certifex · Consultas"
        subtitle="Centros que quieren inscribir su campus y otras consultas desde la web de Certifex"
      />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {PESTANAS.map(({ clave, rotulo }) => (
            <button
              key={clave}
              type="button"
              aria-pressed={pestana === clave}
              onClick={() => setPestana(clave)}
              className={`h-8 px-3 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                pestana === clave
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted/60'
              }`}
            >
              {rotulo}
              {clave === 'nueva' && nuevas > 0 && (
                <span className="rounded-full bg-background/80 px-1.5 text-[10px] font-semibold text-foreground">{nuevas}</span>
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}>
            <ArrowClockwise size={13} weight="bold" className="mr-1.5" />
            {cargando ? 'Cargando…' : 'Actualizar'}
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border text-sm text-muted-foreground">
          {total} {total === 1 ? 'consulta' : 'consultas'}
        </div>
        {filas.length === 0 ? (
          <EmptyState
            icon={SealCheck}
            title={cargando ? 'Cargando…' : 'Nada por aquí'}
            description="Cuando alguien escriba desde la página de contacto de Certifex, aparecerá aquí y sonará la campana."
          />
        ) : (
          <div className="divide-y divide-border">
            {filas.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setAbierta(c)}
                className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/40 transition-colors"
              >
                <span className="mt-0.5 text-muted-foreground">
                  {c.tipo === 'centro' ? <Buildings size={18} /> : <ChatText size={18} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium truncate">{c.tipo === 'centro' && c.organizacion ? c.organizacion : c.nombre}</span>
                    <span className={`text-xs font-medium ${ESTADO[c.estado].color}`}>{ESTADO[c.estado].rotulo}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5">
                      {c.tipo === 'centro' ? 'Campus' : 'Consulta'}
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">{c.nombre} · {c.email} · {cuando(c.recibidaEn)}</span>
                  <span className="block text-sm line-clamp-2 mt-0.5">{c.mensaje}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {abierta && (
        <Detalle
          c={abierta}
          alCerrar={() => setAbierta(null)}
          alGuardar={(c) => { setAbierta(c); void cargar(); }}
        />
      )}
    </div>
  );
}

function Detalle({ c, alCerrar, alGuardar }: {
  c: ConsultaCertifex;
  alCerrar: () => void;
  alGuardar: (c: ConsultaCertifex) => void;
}) {
  const [estado, setEstado] = useState<EstadoConsulta>(c.estado);
  const [nota, setNota] = useState(c.notaInterna ?? '');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      const r = await certifexApi.actualizar(c.id, { estado, notaInterna: nota.trim() || null });
      if (r.success) {
        toast({ title: 'Guardado' });
        alGuardar(r.data);
      } else {
        toast({ title: 'No se pudo guardar', description: r.error, variant: 'destructive' });
      }
    } finally { setGuardando(false); }
  }

  const dato = (k: string, v: React.ReactNode) => (v ? (
    <div className="flex gap-3 text-sm">
      <span className="w-28 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{k}</span>
      <span className="min-w-0 break-words">{v}</span>
    </div>
  ) : null);

  return (
    // `!m-0`: el contenedor de la página pone margen al primer hijo, y con `fixed
    // inset-0` ese margen dejaba una franja sin oscurecer (igual que en Correos).
    <div className="fixed inset-0 !m-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={alCerrar}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="font-bold truncate">{c.tipo === 'centro' && c.organizacion ? c.organizacion : c.nombre}</h2>
            <p className="text-xs text-muted-foreground">
              {c.tipo === 'centro' ? 'Quiere inscribir su campus' : 'Consulta'} · {cuando(c.recibidaEn)}
            </p>
          </div>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground shrink-0">
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            {dato('Persona', c.nombre)}
            {dato('Correo', <span className="font-mono select-all">{c.email}</span>)}
            {dato('Teléfono', c.telefono)}
            {dato('Centro', c.organizacion)}
            {dato('Campus', c.urlCampus ? (
              <a href={c.urlCampus} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">{c.urlCampus}</a>
            ) : null)}
            {dato('Idioma', c.idioma)}
            {dato('Atendida por', c.atendidaPor)}
            {dato('En Certifex', `#${c.certifexId}`)}
          </div>

          <div className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2.5 text-sm">{c.mensaje}</div>

          <label className="block space-y-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Estado</span>
            <select
              id={`certifex-${c.id}-estado`}
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoConsulta)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              {(Object.keys(ESTADO) as EstadoConsulta[]).map((e) => (
                <option key={e} value={e}>{ESTADO[e].rotulo}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Nota interna</span>
            <textarea
              id={`certifex-${c.id}-nota`}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Qué se ha hecho, quién lo lleva… Solo la ve el equipo."
              className="min-h-[90px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Para responder, escribe a <span className="font-mono">{c.email}</span> desde tu correo. Desde aquí no se manda nada.
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
