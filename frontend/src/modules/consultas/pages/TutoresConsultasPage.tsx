import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UsersThree } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { consultasApi, type TutorPanel, type CampusSinTutor } from '../api/consultas.api';
import ConsultasNav, { mensajeDeError, fechaCorta, useUltimaPeticion } from '../components/ConsultasNav';
import { NivelCargaChip } from './MiCargaPage';
import CampusSinTutorAviso from '../components/CampusSinTutorAviso';

/*
  Panel de tutores para administración (#189): el nivel de carga y el texto de
  cada tutor, cuándo lo actualizó y sus datos reales. Lo filtra el selector de
  arriba (empresa, campus o todos).
*/

export default function TutoresConsultasPage() {
  const { activeProject, activeIssuerId } = useProjectContext() as unknown as {
    activeProject: { id?: number | null; nombre?: string } | null; activeIssuerId: number | null;
  };
  const [tutores, setTutores] = useState<TutorPanel[]>([]);
  const [sinTutor, setSinTutor] = useState<CampusSinTutor[]>([]);
  const [plazo, setPlazo] = useState(7);
  const [cargando, setCargando] = useState(true);

  const ambito = useMemo(() => ({ projectId: activeIssuerId ? null : activeProject?.id ?? null, issuerId: activeIssuerId }),
    [activeProject?.id, activeIssuerId]);

  const nueva = useUltimaPeticion();
  const cargar = useCallback(async () => {
    const vale = nueva();
    setCargando(true);
    try {
      const r = await consultasApi.panelDeTutores(ambito);
      if (!vale()) return;
      if (r.success && r.data) { setTutores(r.data.tutores); setSinTutor(r.data.campusSinTutor); setPlazo(r.data.diasPlazoCarga); }
    } catch (e) {
      if (!vale()) return;
      setTutores([]); setSinTutor([]);
      toast({ title: 'No se ha podido cargar el panel de tutores', description: mensajeDeError(e), variant: 'destructive' });
    } finally { if (vale()) setCargando(false); }
  }, [ambito, nueva]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="space-y-4 pb-8">
      <ConsultasNav />
      <PageHeader title="Tutores"
        subtitle={`La carga de trabajo que indica cada tutor y lo que cuenta el CRM. Se marca «desactualizada» a los ${plazo} días sin cambiarla.`} />

      <CampusSinTutorAviso campus={sinTutor} />

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : tutores.length === 0 ? (
        <EmptyState icon={UsersThree} title="No hay tutores aquí" description="Cambia de empresa o de campus en el selector de arriba." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Tutor</th>
                <th scope="col" className="px-3 py-2 font-semibold">Nivel</th>
                <th scope="col" className="px-3 py-2 font-semibold">En qué está</th>
                <th scope="col" className="px-3 py-2 font-semibold">Actualizada</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Alumnos activos</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Consultas abiertas</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Sin mensajes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tutores.map((t) => (
                <tr key={t.id} className="align-top">
                  <td className="px-3 py-2">
                    <span className="font-semibold">{t.nombre}</span>
                    {t.disponible === false && (
                      <span className="ml-1.5 inline-flex rounded px-1.5 py-0.5 text-xs font-semibold bg-muted text-muted-foreground"
                        title={t.motivo_no_disponible || undefined}>No disponible</span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {[...(t.empresas || []), ...t.campus].join(' · ')}
                    </span>
                  </td>
                  <td className="px-3 py-2"><NivelCargaChip nivel={t.carga?.nivel} /></td>
                  <td className="px-3 py-2 max-w-xs whitespace-pre-line">{t.carga?.texto || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {t.carga ? fechaCorta(t.carga.created_at) : 'Nunca'}
                    {t.desactualizada && (
                      <span className="block mt-0.5 w-fit rounded px-1.5 py-0.5 text-xs font-semibold bg-warning-soft text-warning-soft-foreground">Desactualizada</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.alumnos_activos}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.consultas_abiertas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.alumnos_sin_mensajes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Las fichas de los tutores, sus campus y sus empresas están en <Link to="/tutores" className="underline">Tutores</Link>.
      </p>
    </div>
  );
}
