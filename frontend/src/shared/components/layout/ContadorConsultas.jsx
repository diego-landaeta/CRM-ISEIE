import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import usePermission from '@/shared/hooks/usePermission';
import client from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';

/**
 * El aviso en «Consultas» del menú (gemela de CRM#1082; Diego, 24/11: «si alguien
 * escribe, que se vea un símbolo de notificación, no solo en la campana, sino donde
 * dice Consultas»). Cuántas esperan respuesta: la tutora, las suyas; administración,
 * las de su campus. Cada 2 minutos y al volver a la pestaña. Sin nada, no pinta nada.
 */
export default function ContadorConsultas({ collapsed = false }) {
  // En ISEIE el campus activo lo da AuthContext (ProjectContext lo lee de ahí).
  const { user, activeProject } = useAuth();
  const { can } = usePermission();
  const atiende = can('consultas.atender');
  const ve = can('consultas.view');
  const proyecto = activeProject?.id ?? null;
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!user || (!atiende && !ve)) { setN(0); return undefined; }
    let cancelado = false;
    let intervalo = null;
    async function contar() {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        let url = '/consultas/mias?estado=pendientes';
        if (!atiende) {
          const p = new URLSearchParams({ estado: 'pendientes' });
          if (proyecto > 0) p.set('projectId', String(proyecto));
          url = `/consultas?${p.toString()}`;
        }
        const res = await client.get(url);
        const d = res?.data;
        if (!cancelado && res?.success) setN(Number(d?.total ?? d?.consultas?.length ?? 0) || 0);
      } catch { /* sin contador, el menú sigue */ }
    }
    function arrancar() { parar(); contar(); intervalo = setInterval(contar, 2 * 60 * 1000); }
    function parar() { if (intervalo) { clearInterval(intervalo); intervalo = null; } }
    function alVolver() { if (document.hidden) parar(); else arrancar(); }
    if (typeof document === 'undefined' || !document.hidden) arrancar();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', alVolver);
    return () => {
      cancelado = true;
      parar();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', alVolver);
    };
  }, [user, atiende, ve, proyecto]);

  if (!n) return null;
  const texto = n > 9 ? '9+' : String(n);
  return (
    <span aria-label={`${n} por contestar`} title={`${n} por contestar`}
      className={cn('inline-grid min-w-[18px] h-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground',
        collapsed ? 'absolute right-1 top-1' : 'ml-auto')}>
      {texto}
    </span>
  );
}
