import { useEffect, useState } from 'react';
import { CaretDown, Check, WhatsappLogo } from '@phosphor-icons/react';
import { usuariosWhatsapp, type UsuarioWhatsapp } from '../api/whatsapp.api';
import { useProjectContext } from '@/contexts/ProjectContext';
import { ambitoComoObjeto } from '@/shared/lib/ambitoInforme';

// ¿De quién es el WhatsApp que estoy viendo?
//
// Una gestora ve el suyo y nada más — para ella este selector no se pinta
// siquiera, porque el servidor le devuelve una sola persona. Quien manda puede
// cambiar de sesión: enlazar el número de una gestora que tiene al lado con su
// móvil, o entrar a leer una conversación cuando ella no está.
//
// Se enseña SIEMPRE de quién es lo que hay en pantalla, aunque sea lo propio.
// Estar leyendo los mensajes de otra persona sin que se note es justo lo que no
// puede pasar: quien mira tiene que saber que está mirando.

export interface SesionElegida {
  usuarioId: number | null;      // null = la mía
  nombre: string;
  esMia: boolean;
}

export default function SelectorDeSesion({
  valor, onCambiar, compacto = false,
}: {
  valor: SesionElegida;
  onCambiar: (s: SesionElegida) => void;
  compacto?: boolean;
}) {
  // El selector es de la EMPRESA puesta arriba: con CEDIA no pinta la gente de
  // ICTESS. Diego, 15/09: «el whatsapp es por empresa, no puedo tener de varias
  // alli». Quien lo acota de verdad es el servidor; aqui solo se le dice cual.
  const { activeProject, activeIssuerId } = useProjectContext() as {
    activeProject: { id?: number | null } | null; activeIssuerId: number | null;
  };
  const [gente, setGente] = useState<UsuarioWhatsapp[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    usuariosWhatsapp(ambitoComoObjeto({ activeIssuerId, activeProject }))
      .then((r) => setGente(r.success ? (r.data || []) : []))
      .catch(() => setGente([]))
      .finally(() => setCargando(false));
  }, [activeProject?.id, activeIssuerId]);

  // Quien no lo usa no se pinta (#128): Diego pidio que el panel fuera «solo
  // gestoras y Daniela», y una lista con quince nombres apagados no es un panel.
  //
  // Pero no se esconde en silencio: los que faltan se cuentan al pie. Sin eso
  // volveriamos justo a lo de la #68 —alguien no sale y parece una averia—, solo
  // que ahora con una casilla detras que nadie recordaria haber tocado.
  //
  // Uno mismo sale siempre, aunque este apagado: ver «Mi WhatsApp» y que no vaya
  // se explica con el motivo del servidor; no verse en la lista, no.
  const visibles = gente.filter((u) => u.usa !== false || u.soyYo);
  const apagados = gente.length - visibles.length;

  // Con una sola persona no hay nada que elegir: es su propio WhatsApp.
  if (cargando || visibles.length <= 1) return null;

  const elegir = (u: UsuarioWhatsapp) => {
    onCambiar({ usuarioId: u.soyYo ? null : u.id, nombre: u.nombre, esMia: u.soyYo });
    setAbierto(false);
  };

  // Solo cuenta a quien PUEDE tener WhatsApp. Desde que los que no pueden
  // aparecen en la lista, contarlos diria «1 de 6» incluyendo a un tutor que
  // nunca va a enlazar nada — un objetivo imposible de cumplir.
  const conDerecho = visibles.filter((u) => u.puede !== false);
  const enlazadas = conDerecho.filter((u) => u.conectado).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={`flex items-center gap-2 rounded-md border border-border bg-card hover:bg-muted/50 transition-colors ${
          compacto ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm'
        }`}
      >
        <WhatsappLogo size={compacto ? 14 : 16} weight="fill" className="text-emerald-600 shrink-0" />
        <span className="truncate max-w-[180px]">
          {valor.esMia ? 'Mi WhatsApp' : `WhatsApp de ${valor.nombre}`}
        </span>
        <CaretDown size={12} weight="bold" className="text-muted-foreground shrink-0" />
      </button>

      {abierto && (
        <>
          {/* Cerrar al pulsar fuera, que es lo que hace todo el mundo. */}
          <div className="fixed inset-0 z-40" onClick={() => setAbierto(false)} />
          <div className="absolute z-50 mt-1 w-72 max-h-80 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
            <p className="px-3 py-2 text-[11px] text-muted-foreground border-b border-border">
              {enlazadas} de {conDerecho.length} tienen su número enlazado
            </p>
            {visibles.map((u) => {
              const puesta = u.soyYo ? valor.esMia : valor.usuarioId === u.id;
              // Dos motivos distintos para lo mismo: no le corresponde (rol) o
              // no lo usa (la casilla del #128). El segundo solo se ve en la
              // propia fila, porque los demas apagados ni se pintan.
              const bloqueada = u.puede === false || u.usa === false;
              const razon = u.puede === false
                ? u.motivo
                : (u.usa === false ? 'No tienes activado el WhatsApp del CRM' : null);
              return (
                <button
                  key={u.id}
                  type="button"
                  // `puede === false` viene del servidor con su motivo. Se pinta
                  // apagada en vez de esconderla: no salir es la peor forma de
                  // negar algo. Ver la tarea #68.
                  disabled={bloqueada}
                  onClick={() => elegir(u)}
                  title={razon || undefined}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2.5 ${
                    bloqueada
                      ? 'opacity-60 cursor-not-allowed'
                      : `hover:bg-muted/50 ${puesta ? 'bg-primary/10' : ''}`
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      bloqueada ? 'bg-muted-foreground/30'
                      : u.conectado ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                    }`}
                    title={bloqueada ? 'sin WhatsApp' : (u.conectado ? 'enlazado' : 'sin enlazar')}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate">
                      {u.soyYo ? 'Mi WhatsApp' : u.nombre}
                    </span>
                    {/* El motivo entero, no cortado: es lo unico que evita que
                        alguien pierda la tarde preguntandose por que no sale. */}
                    <span className={`block text-[11px] ${
                      bloqueada ? 'text-muted-foreground' : 'text-muted-foreground truncate'
                    }`}>
                      {bloqueada
                        ? razon
                        : <>
                            {u.conectado ? (u.numero ? `+${u.numero}` : 'enlazado') : 'sin enlazar'}
                            {!u.soyYo && ` · ${u.role}`}
                          </>}
                    </span>
                  </span>
                  {puesta && !bloqueada && (
                    <Check size={14} weight="bold" className="text-primary shrink-0" />
                  )}
                </button>
              );
            })}
            {/* Los que no salen, contados. Es la diferencia entre «faltan tres
                porque estan apagados» y «falta gente y no se sabe por que», que
                es lo que costo la #68. */}
            {apagados > 0 && (
              <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
                {apagados === 1
                  ? '1 persona más no usa el WhatsApp del CRM'
                  : `${apagados} personas más no usan el WhatsApp del CRM`}
                <span className="block">Se enciende en su ficha de usuario.</span>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
