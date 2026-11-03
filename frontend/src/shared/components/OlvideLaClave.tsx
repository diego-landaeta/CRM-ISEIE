import { useState } from 'react';
import client from '@/shared/api/client';

/**
 * «He olvidado la contraseña» (#37).
 *
 * Va DENTRO de la pantalla de entrar y no en una ruta aparte, por dos razones.
 * La de fondo: quien ha olvidado la clave no quiere cambiar de sitio, quiere
 * volver a entrar, y el camino corto es pedirlo donde ya esta. La practica:
 * una ruta nueva pasa por `App.jsx` y el menu, que son dos de los cuatro
 * sitios donde el equipo choca siempre (#127), y esto no los necesita.
 *
 * EL MENSAJE ES EL MISMO EXISTA EL CORREO O NO, y no es pereza: es la regla
 * del ticket. Aqui ni siquiera se puede saber cual fue —el servidor contesta
 * lo mismo a los dos— asi que la pantalla no tiene nada que esconder.
 */
export default function OlvideLaClave({ correoInicial = '' }: { correoInicial?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [email, setEmail] = useState(correoInicial);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function pedir() {
    setFallo(null);
    if (!email.trim()) { setFallo('Escribe tu correo'); return; }

    setEnviando(true);
    try {
      await client.post('/auth/forgot-password', { email: email.trim() });
      setHecho(true);
    } catch (err) {
      // Solo se llega aqui si el correo esta mal escrito o hemos pedido
      // demasiadas veces. Un correo que no existe NO cae aqui: contesta bien.
      const e2 = err as { message?: string };
      setFallo(e2?.message || 'No se ha podido pedir. Intentalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  if (!abierto) {
    return (
      <p className="text-xs text-center pt-1">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="text-muted-foreground hover:text-foreground hover:underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
        >
          ¿Has olvidado tu contraseña?
        </button>
      </p>
    );
  }

  if (hecho) {
    return (
      <div role="status" className="text-sm text-center bg-muted/50 border border-border rounded-lg px-4 py-3 space-y-1">
        <p className="font-medium">Mira tu correo</p>
        <p className="text-xs text-muted-foreground">
          Si ese correo tiene una cuenta activa, le llega un enlace para poner una contraseña nueva.
          Caduca en 24 horas y solo sirve una vez.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <p className="text-xs text-muted-foreground">
        Escribe tu correo y te mandamos un enlace para poner una contraseña nueva.
      </p>
      {/* Ojo: NO es un <form>. Este bloque vive dentro del formulario de entrar,
          y un formulario dentro de otro no es HTML valido — el navegador lo
          desanida y el boton acaba enviando el de fuera, o sea intentando
          entrar con la clave que la persona no recuerda. */}
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          placeholder="tu@correo.com"
          aria-label="Correo para recuperar la contraseña"
          autoComplete="email"
          className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="button"
          onClick={pedir}
          disabled={enviando}
          className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {enviando ? 'Enviando...' : 'Enviar'}
        </button>
      </div>
      {fallo && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{fallo}</p>}
      <button
        type="button"
        onClick={() => setAbierto(false)}
        className="text-xs text-muted-foreground hover:underline underline-offset-2"
      >
        Volver a entrar
      </button>
    </div>
  );
}
