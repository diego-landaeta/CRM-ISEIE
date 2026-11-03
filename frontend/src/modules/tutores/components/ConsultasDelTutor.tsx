import { useEffect, useMemo, useState } from 'react';
import { ArrowsClockwise, Buildings, CheckCircle, Warning, X } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import { Button } from '@/shared/components/ui/button';
import Field from '@/shared/components/ui/Field';
import Select from '@/shared/components/ui/Select';
import { inputClass } from '@/shared/lib/ui';
import {
  campusTutorApi, type CampusDelTutor, type EstadoMatricula, type PanelCampusTutor,
} from '../api/campusTutor.api';
import { consultasApi } from '@/modules/consultas/api/consultas.api';

/*
  Consultas de alumnos, fase 1 (#187), en la ficha del tutor:

    · en qué campus atiende las consultas: los suyos y los de sus empresas
      enteras (una empresa cubre también los campus que se creen después);
    · si está dado de alta en el campus (Moodle) de cada uno: activa, pendiente
      de matrícula o baja. Sin matrícula activa no recibe consultas de ese campus;
    · «No disponible» (vacaciones o baja): sus consultas irán a otro tutor.

  Va en su propio componente para no tocar la ficha más que para montarlo.
*/

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

function Matricula({ c }: { c: CampusDelTutor }) {
  if (!c.campus_conectado) {
    return <span className="text-xs text-muted-foreground">Campus sin conectar</span>;
  }
  const estado: Record<Exclude<EstadoMatricula, null>, { texto: string; clase: string }> = {
    activa: { texto: 'Matriculado', clase: 'bg-success-soft text-success-soft-foreground' },
    pendiente: { texto: 'Pendiente de matrícula', clase: 'bg-warning-soft text-warning-soft-foreground' },
    baja: { texto: 'Baja en el campus', clase: 'bg-destructive-soft text-destructive-soft-foreground' },
  };
  if (!c.estado) return <span className="text-xs text-muted-foreground">Sin comprobar</span>;
  const e = estado[c.estado];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${e.clase}`}>{e.texto}</span>;
}

export default function ConsultasDelTutor({ tutorId, puedeGestionar }: { tutorId: number; puedeGestionar: boolean }) {
  const { projects } = useProjectContext() as unknown as {
    projects: Array<{ id: number; nombre: string; sociedad_emisora_id?: number | null; sociedad_nombre?: string | null }>;
  };
  const [panel, setPanel] = useState<PanelCampusTutor | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [campusNuevo, setCampusNuevo] = useState<number | null>(null);
  const [empresaNueva, setEmpresaNueva] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  // #188: el token del tutor en cada campus, para que la respuesta salga en su nombre.
  const [tokens, setTokens] = useState<Array<{ project_id: number; campus: string; estado: string | null; tiene_token: boolean }>>([]);
  const [campusToken, setCampusToken] = useState<number | null>(null);
  const [token, setToken] = useState('');

  useEffect(() => {
    if (!puedeGestionar) return;
    consultasApi.tokensDelTutor(tutorId).then((r) => { if (r.success && r.data) setTokens(r.data); }).catch(() => {});
  }, [tutorId, puedeGestionar, panel]);

  async function guardarToken(quitar = false) {
    if (!campusToken) return;
    if (!quitar && !token.trim()) {
      toast({ title: 'Falta el token', description: 'Pégalo en «Token del tutor en ese campus».', variant: 'destructive' });
      return;
    }
    setOcupado(true);
    try {
      const r = await consultasApi.guardarToken(tutorId, campusToken, quitar ? null : token.trim());
      if (r.success) {
        toast({ title: quitar ? 'Token quitado' : 'Token guardado', description: quitar ? '' : 'Sus respuestas saldrán en su nombre en ese campus.' });
        setToken('');
        const t = await consultasApi.tokensDelTutor(tutorId);
        if (t.success && t.data) setTokens(t.data);
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se ha podido guardar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setAvisos([]);
    campusTutorApi.ver(tutorId)
      .then((r) => { if (vivo && r.success && r.data) setPanel(r.data); })
      .catch(() => { if (vivo) setPanel(null); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [tutorId]);

  // Los campus que aún no tiene, de los que lleva quien está mirando.
  const campusParaAnadir = useMemo(() => {
    const tiene = new Set((panel?.campus || []).map((c) => c.project_id));
    return (projects || []).filter((p) => p.id > 0 && !tiene.has(p.id));
  }, [projects, panel]);

  // Las empresas de esos campus que aún no tiene enteras.
  const empresasParaAnadir = useMemo(() => {
    const tiene = new Set((panel?.empresas || []).map((e) => e.issuer_id));
    const vistas = new Map<number, string>();
    for (const p of projects || []) {
      const id = Number(p.sociedad_emisora_id);
      if (id > 0 && !tiene.has(id) && !vistas.has(id)) vistas.set(id, p.sociedad_nombre || `Empresa ${id}`);
    }
    return [...vistas].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [projects, panel]);

  async function hacer(accion: () => Promise<{ success: boolean; data?: PanelCampusTutor; error?: string }>, hecho: string) {
    setOcupado(true);
    try {
      const r = await accion();
      if (r.success && r.data) {
        setPanel(r.data);
        setAvisos(r.data.avisos || []);
        if (r.data.avisos?.length) {
          toast({ title: 'Revisa la matrícula en el campus', description: r.data.avisos[0], variant: 'destructive' });
        } else {
          toast({ title: hecho });
        }
      } else {
        toast({ title: 'No se ha podido guardar', description: r.error || 'Inténtalo de nuevo.', variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se ha podido guardar', description: err?.data?.error || err?.message || 'Inténtalo de nuevo.', variant: 'destructive' });
    } finally {
      setOcupado(false);
    }
  }

  if (cargando) {
    return <section className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">Cargando los campus de consultas…</section>;
  }
  if (!panel) return null;

  const conectados = panel.campus.filter((c) => c.campus_conectado).length;

  return (
    <section className="mt-6 border-t border-border pt-4 space-y-4" aria-labelledby={`consultas-tutor-${tutorId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`consultas-tutor-${tutorId}`} className="font-bold text-sm">Consultas de alumnos</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            En qué campus atiende las consultas y si está dado de alta en el campus de cada uno.
            Sin matrícula en el campus no recibe consultas de ese campus.
          </p>
        </div>
        {puedeGestionar && conectados > 0 && (
          <Button variant="outline" size="sm" disabled={ocupado}
            onClick={() => hacer(() => campusTutorApi.comprobar(tutorId), 'Comprobado en los campus')}>
            <ArrowsClockwise size={14} weight="bold" className="mr-1.5" /> Comprobar en los campus
          </Button>
        )}
      </div>

      {avisos.length > 0 && (
        <div role="alert" className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground space-y-1">
          {avisos.map((a) => (
            <p key={a} className="flex items-start gap-1.5"><Warning size={14} weight="fill" className="mt-0.5 shrink-0" />{a}</p>
          ))}
        </div>
      )}

      {/* Disponibilidad (decisión 6): vacaciones o baja. */}
      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        {panel.disponible ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
            <CheckCircle size={13} weight="fill" /> Disponible para consultas
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning-soft-foreground">
            <Warning size={13} weight="fill" /> No disponible
            {panel.motivo_no_disponible ? ` · ${panel.motivo_no_disponible}` : ''}
            {panel.no_disponible_desde ? ` · desde ${fecha(panel.no_disponible_desde)}` : ''}
          </span>
        )}
        {puedeGestionar && (panel.disponible ? (
          <div className="flex gap-2 sm:w-[26rem]">
            <div className="min-w-0 flex-1">
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} autoComplete="off"
                placeholder="Motivo (vacaciones, baja…)" aria-label="Motivo de no disponible"
                className={inputClass} />
            </div>
            <Button variant="outline" size="sm" disabled={ocupado} className="shrink-0"
              onClick={() => hacer(() => campusTutorApi.disponible(tutorId, false, motivo.trim() || null), 'Marcado como no disponible')
                .then(() => setMotivo(''))}>
              Marcar no disponible
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" disabled={ocupado}
            onClick={() => hacer(() => campusTutorApi.disponible(tutorId, true), 'Vuelve a estar disponible')}>
            Volver a disponible
          </Button>
        ))}
      </div>

      {/* Los campus: los suyos y los de sus empresas. */}
      {panel.campus.length === 0 ? (
        <p className="text-sm text-muted-foreground">No atiende consultas en ningún campus todavía.</p>
      ) : (
        // Una lista y no una tabla: en el móvil cada campus va en su bloque, sin
        // columnas que se salgan por la derecha.
        <div>
          <div aria-hidden="true" className="hidden sm:grid grid-cols-[1.4fr_1fr_1.3fr_1fr] gap-3 border-b border-border py-2 text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
            <span>Campus</span><span>Por</span><span>Matrícula en el campus</span><span>Comprobado</span>
          </div>
          <ul className="divide-y divide-border" aria-label="Campus en los que atiende consultas">
            {panel.campus.map((c) => (
              <li key={c.project_id} className="grid grid-cols-1 gap-1 py-2 text-sm sm:grid-cols-[1.4fr_1fr_1.3fr_1fr] sm:items-center sm:gap-3">
                <span className="font-medium sm:font-normal">{c.campus}</span>
                <span className="text-xs text-muted-foreground sm:text-sm">
                  {c.via === 'empresa' ? `Por la empresa ${c.empresa || ''}` : 'Campus asignado'}
                </span>
                <span><Matricula c={c} /></span>
                <span className="text-xs text-muted-foreground">
                  {c.comprobado_at ? `Comprobado el ${fecha(c.comprobado_at)}` : ''}
                  {c.error && <span className="block text-destructive">{c.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {panel.empresas.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Empresas enteras">
          {panel.empresas.map((e) => (
            <span key={e.issuer_id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs">
              <Buildings size={13} weight="bold" /> {e.empresa} · {e.campus} campus
              {puedeGestionar && (
                <button type="button" disabled={ocupado} aria-label={`Quitar la empresa ${e.empresa}`}
                  onClick={() => hacer(() => campusTutorApi.quitarEmpresa(tutorId, e.issuer_id), 'Empresa quitada')}
                  className="text-muted-foreground hover:text-destructive">
                  <X size={12} weight="bold" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {puedeGestionar && tokens.some((t) => t.estado === 'activa') && (
        // #188: para que su respuesta salga en su nombre en el campus hace falta
        // SU token de ese Moodle (con un token común saldría firmada por otro).
        <div className="rounded-md border border-border p-3 space-y-2">
          <p className="text-sm font-semibold">Responder en su nombre</p>
          <ul className="flex flex-wrap gap-2 text-xs" aria-label="Token del tutor por campus">
            {tokens.filter((t) => t.estado === 'activa').map((t) => (
              <li key={t.project_id} className={`rounded px-1.5 py-0.5 font-semibold ${t.tiene_token ? 'bg-success-soft text-success-soft-foreground' : 'bg-warning-soft text-warning-soft-foreground'}`}>
                {t.campus}: {t.tiene_token ? 'token puesto' : 'falta su token'}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
            <Field label="Campus">
              <Select<number | null>
                value={campusToken}
                onChange={setCampusToken}
                ariaLabel="Campus del token"
                options={[{ value: null, label: 'Elige el campus…' },
                  ...tokens.filter((t) => t.estado === 'activa').map((t) => ({ value: t.project_id, label: t.campus }))]}
              />
            </Field>
            <Field label="Token del tutor en ese campus" htmlFor={`token-tutor-${tutorId}`}>
              <input id={`token-tutor-${tutorId}`} type="password" value={token} onChange={(e) => setToken(e.target.value)}
                autoComplete="off" placeholder="El token de su usuario en el Moodle" className={`${inputClass} font-mono`} />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" disabled={ocupado || !campusToken} onClick={() => guardarToken(false)}>Guardar</Button>
              {tokens.find((t) => t.project_id === campusToken)?.tiene_token && (
                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => guardarToken(true)}>Quitar</Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            En el Moodle: <strong>Administración del sitio → Servidor → Servicios web → Administrar tokens → Crear token</strong>,
            para su usuario y el servicio del CRM (con <code>core_message_send_instant_messages</code>). Su rol necesita el permiso <code>webservice/rest:use</code>.
          </p>
        </div>
      )}

      {puedeGestionar && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Añadir un campus" hint="Se comprueba en ese campus si su correo es usuario.">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Select<number | null>
                  value={campusNuevo}
                  onChange={setCampusNuevo}
                  ariaLabel="Añadir un campus"
                  placeholder="Elige el campus…"
                  options={[{ value: null, label: 'Elige el campus…' }, ...campusParaAnadir.map((p) => ({ value: p.id, label: p.nombre }))]}
                />
              </div>
              <Button size="sm" disabled={ocupado || !campusNuevo}
                onClick={() => campusNuevo && hacer(() => campusTutorApi.asignarCampus(tutorId, campusNuevo), 'Campus añadido')
                  .then(() => setCampusNuevo(null))}>
                Añadir
              </Button>
            </div>
          </Field>
          <Field label="Añadir una empresa entera" hint="Cubre todos sus campus, también los que se creen después.">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Select<number | null>
                  value={empresaNueva}
                  onChange={setEmpresaNueva}
                  ariaLabel="Añadir una empresa entera"
                  placeholder="Elige la empresa…"
                  options={[{ value: null, label: 'Elige la empresa…' }, ...empresasParaAnadir.map((e) => ({ value: e.id, label: e.nombre }))]}
                />
              </div>
              <Button size="sm" disabled={ocupado || !empresaNueva}
                onClick={() => empresaNueva && hacer(() => campusTutorApi.asignarEmpresa(tutorId, empresaNueva), 'Empresa añadida')
                  .then(() => setEmpresaNueva(null))}>
                Añadir
              </Button>
            </div>
          </Field>
        </div>
      )}
    </section>
  );
}
