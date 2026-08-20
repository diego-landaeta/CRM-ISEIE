import { useEffect, useState } from 'react';
import { CaretDown, Check, WhatsappLogo } from '@phosphor-icons/react';
import { usuariosWhatsapp, type UsuarioWhatsapp } from '../api/whatsapp.api';

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
  const [gente, setGente] = useState<UsuarioWhatsapp[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    usuariosWhatsapp()
      .then((r) => setGente(r.success ? (r.data || []) : []))
      .catch(() => setGente([]))
      .finally(() => setCargando(false));
  }, []);

  // Con una sola persona no hay nada que elegir: es su propio WhatsApp.
  if (cargando || gente.length <= 1) return null;

  const elegir = (u: UsuarioWhatsapp) => {
    onCambiar({ usuarioId: u.soyYo ? null : u.id, nombre: u.nombre, esMia: u.soyYo });
    setAbierto(false);
  };

  const enlazadas = gente.filter((u) => u.conectado).length;

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
              {enlazadas} de {gente.length} tienen su número enlazado
            </p>
            {gente.map((u) => {
              const puesta = u.soyYo ? valor.esMia : valor.usuarioId === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => elegir(u)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-muted/50 ${
                    puesta ? 'bg-primary/10' : ''
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${u.conectado ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                    title={u.conectado ? 'enlazado' : 'sin enlazar'}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate">
                      {u.soyYo ? 'Mi WhatsApp' : u.nombre}
                    </span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {u.conectado ? (u.numero ? `+${u.numero}` : 'enlazado') : 'sin enlazar'}
                      {!u.soyYo && ` · ${u.role}`}
                    </span>
                  </span>
                  {puesta && <Check size={14} weight="bold" className="text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
