import { useCallback, useEffect, useState } from 'react';
import { EnvelopeSimple, WarningCircle } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

/**
 * Encender y apagar los avisos por correo.
 *
 * Cuarta subfase de la tarea #28. Van todos encendidos por defecto: en la base
 * se guarda solo lo APAGADO, asi que quien entre nuevo los recibe desde el
 * primer dia sin que nadie lo de de alta en ninguna parte.
 *
 * Cada persona gestiona LOS SUYOS. No hace falta ser admin y nadie puede tocar
 * los de otro — el usuario sale del testigo de sesion, no de la peticion.
 */
export default function AvisosPorCorreo() {
  const [avisos, setAvisos] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await client.get('/users/mis-avisos');
      if (!r.success) throw new Error(r.error || 'No se pudieron cargar');
      setAvisos(r.data || []);
    } catch (e) {
      setError(e.message);
      setAvisos([]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = async (aviso, encendido) => {
    setGuardando(aviso);
    // Se pinta el cambio antes de que conteste el servidor: una casilla que
    // tarda medio segundo en moverse se pulsa dos veces.
    setAvisos((prev) => prev.map((a) => (a.aviso === aviso ? { ...a, encendido } : a)));
    try {
      const r = await client.patch('/users/mis-avisos', { aviso, encendido });
      if (!r.success) throw new Error(r.error || 'No se pudo guardar');
    } catch (e) {
      // Y si falla se devuelve a como estaba: dejarlo pintado como si se
      // hubiera guardado seria mentir, y la gestora dejaria de recibir avisos
      // creyendo lo contrario — o al reves.
      setAvisos((prev) => prev.map((a) => (a.aviso === aviso ? { ...a, encendido: !encendido } : a)));
      toast({ title: 'No se pudo guardar', description: e.message, variant: 'destructive' });
    } finally {
      setGuardando(null);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <EnvelopeSimple size={18} weight="duotone" className="text-primary" />
        <h3 className="font-bold">Avisos por correo</h3>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Llegan a tu correo. Los apagas aquí y dejas de recibirlos, sin que afecte a nadie más.
      </p>

      {avisos === null && !error && (
        <div className="space-y-2" aria-busy="true">
          <span className="sr-only">Cargando tus avisos…</span>
          {[0, 1, 2].map((i) => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm">
          <WarningCircle size={16} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="text-foreground">{error}</span>
          <button type="button" onClick={cargar} className="underline text-muted-foreground">
            Reintentar
          </button>
        </div>
      )}

      {avisos?.map((a) => (
        <label
          key={a.aviso}
          className="flex items-start gap-3 py-2 cursor-pointer group"
        >
          <input
            type="checkbox"
            checked={a.encendido}
            disabled={guardando === a.aviso}
            onChange={(e) => cambiar(a.aviso, e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{a.titulo}</span>
            <span className="block text-xs text-muted-foreground">{a.detalle}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
