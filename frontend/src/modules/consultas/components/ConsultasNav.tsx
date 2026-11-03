import { ChatCircleText, UserCircleMinus, Gauge, UsersThree, ChartBar } from '@phosphor-icons/react';
import { useCallback, useRef } from 'react';
import SubNav from '@/shared/components/ui/SubNav';
import { useAuth } from '@/contexts/AuthContext';
import { tieneRol } from '@/shared/lib/roles';
import usePermission from '@/shared/hooks/usePermission';

/*
  Las pestañas de Consultas (#189): la bandeja, los alumnos sin mensajes, la
  carga de trabajo (del tutor), el panel de tutores (de administración) y las
  métricas.
*/

export function useQuienSoy() {
  const { user } = useAuth() as { user: { role?: string; roles_extra?: string[] } | null };
  // Lo que dice el servidor (#423): sale si salía antes Y tiene el permiso.
  const { can } = usePermission();
  return {
    esTutor: tieneRol(user as never, 'tutor') && can('consultas.atender'),
    // Como el servidor (`veTodoElCrm`): superadmin y soporte solo como rol principal.
    esAdmin: (['superadmin', 'soporte'].includes(user?.role || '') || tieneRol(user as never, 'admin')) && can('consultas.view'),
  };
}

export default function ConsultasNav() {
  const { esTutor, esAdmin } = useQuienSoy();
  const tabs = [
    { label: 'Consultas', to: '/consultas', icon: ChatCircleText },
    { label: 'Alumnos sin mensajes', to: '/consultas/alumnos', icon: UserCircleMinus },
    ...(esTutor ? [{ label: 'Mi carga', to: '/consultas/carga', icon: Gauge }] : []),
    ...(esAdmin ? [{ label: 'Tutores', to: '/consultas/tutores', icon: UsersThree }] : []),
    { label: 'Métricas', to: '/consultas/metricas', icon: ChartBar },
  ];
  return <SubNav tabs={tabs} sectionLabel="Consultas" sectionIcon={ChatCircleText} />;
}

/** «Mías» o «De todos», para quien es tutor y administración a la vez. */
export function VistaMiasTodas({ vista, onChange, textoMias }: { vista: 'mias' | 'todas'; onChange: (v: 'mias' | 'todas') => void; textoMias: string }) {
  return (
    <div role="tablist" aria-label="De quién" className="inline-flex rounded-md border border-border bg-muted p-0.5">
      {(['mias', 'todas'] as const).map((v) => (
        <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => onChange(v)}
          className={`h-8 px-3 rounded text-sm font-semibold ${vista === v ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>
          {v === 'mias' ? textoMias : 'De todos'}
        </button>
      ))}
    </div>
  );
}

export function mensajeDeError(e: unknown) {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message;
}

export const fechaCorta = (s: string | null | undefined) => {
  if (!s) return '—';
  // Un día suelto («2026-10-02») se escribe tal cual: con `new Date` se leía como
  // medianoche UTC y en América salía el día de antes.
  const dia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dia) return `${Number(dia[3])}/${Number(dia[2])}/${dia[1]}`;
  return new Date(s).toLocaleDateString('es-ES');
};

/** Solo vale la respuesta de la última petición: una vieja que llegue tarde no pisa a la nueva. */
export function useUltimaPeticion() {
  const n = useRef(0);
  return useCallback(() => { const yo = ++n.current; return () => yo === n.current; }, []);
}
