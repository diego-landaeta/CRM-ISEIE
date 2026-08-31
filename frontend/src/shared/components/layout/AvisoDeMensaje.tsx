import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '@/shared/api/client';

/**
 * «Te ha escrito alguien por WhatsApp».
 *
 * Antes de esto el CRM **no avisaba de nada** cuando entraba un mensaje: ni
 * sonido, ni aviso del sistema, ni el número en la pestaña. La gestora solo se
 * enteraba si tenía el chat abierto y estaba mirando en ese momento.
 *
 * Y no era que el aviso estuviera roto: es que no existía. Había tres muros, y
 * cada uno bastaba por sí solo —
 *
 *   1. El backend no creaba ningún aviso al llegar un WhatsApp.
 *   2. `showLocal`, que dispara el aviso del navegador, solo la llamaba el
 *      botón «probar» de la página de Notificaciones.
 *   3. La suscripción a push era un simulacro: escribía `endpoint: 'local-only'`
 *      en el navegador, ponía «suscrita» y `/api/push-subscriptions` no existe.
 *
 * Esto tira los tres para el caso que importa —el CRM abierto—, que es donde
 * pasa la jornada. Con el CRM cerrado hace falta push de verdad: claves VAPID,
 * endpoint y configuración de servidor. Eso no está aquí, y prometerlo sería
 * repetir el error del simulacro.
 *
 * Se monta una vez en AppLayout, igual que el aviso de llamada, para que avise
 * desde Prospectos, Facturación o donde esté.
 */

// Cada cuanto se pregunta. Un mensaje no es una llamada: nadie descuelga, asi
// que no hace falta el latido de tres segundos del aviso de llamada.
const CADA_ENLAZADA_MS = 10000;
const CADA_SIN_ENLAZAR_MS = 60000;

type Ultimo = {
  id: number;
  conversacionId: number;
  quien: string | null;
  esGrupo: boolean;
  tipo: string;
  texto: string | null;
  ts: string;
};

type SinLeer = {
  total: number;
  conversaciones: number;
  ultimo: Ultimo | null;
  enlazada: boolean;
};

/** Lo que se lee en el aviso cuando no hay texto que enseñar. */
const COMO_SE_DICE: Record<string, string> = {
  imagen: 'Te ha mandado una foto',
  video: 'Te ha mandado un vídeo',
  audio: 'Te ha mandado una nota de voz',
  documento: 'Te ha mandado un archivo',
  sticker: 'Te ha mandado un sticker',
  llamada: 'Te ha llamado',
};

/** El título original, para devolverlo cuando no queda nada sin leer. */
const TITULO_BASE = typeof document !== 'undefined' ? document.title : '';

export default function AvisoDeMensaje() {
  // Con WhatsApp apagado no hay nada que avisar, y esto vive en el layout: sin
  // la comprobacion estaria preguntando desde todas las pantallas del CRM y
  // para todos los usuarios por un modulo que ni se enseña.
  // En ISEIE no hay modulos apagables —el CRM hermano los gatea con
  // `installation_bundles` y este monta todo—, asi que WhatsApp esta siempre
  // encendido. Se deja la variable para que el resto del componente sea
  // identico al del otro repo.
  const apagado = false;
  const navigate = useNavigate();
  const [enlazada, setEnlazada] = useState(false);
  // Se guarda en una ref para que el aviso ya lanzado siga sabiendo navegar sin
  // que `preguntar` tenga que rehacerse —y reiniciar el reloj— en cada vuelta.
  const irAlChat = useRef((id: number) => { navigate(`/whatsapp/chat?conv=${id}`); });
  irAlChat.current = (id: number) => { navigate(`/whatsapp/chat?conv=${id}`); };
  // El ultimo por el que YA se aviso. Sin esto, cada vuelta repetiria el mismo
  // aviso cada diez segundos hasta que abriera el chat.
  const avisado = useRef<number | null>(null);
  // La primera vuelta no avisa: al entrar al CRM puede haber cosas sin leer de
  // ayer, y saltarian todas de golpe como si acabaran de entrar.
  const primera = useRef(true);

  const preguntar = useCallback(async () => {
    try {
      const r = await client.get('/whatsapp/sin-leer');
      if (!r.success) return;
      const d = r.data as SinLeer;
      setEnlazada(Boolean(d?.enlazada));

      // El numero en la pestaña. Es lo unico que se ve con el CRM en otra
      // pestaña y sin permiso de notificaciones, asi que va siempre.
      if (typeof document !== 'undefined') {
        document.title = d.total > 0 ? `(${d.total}) ${TITULO_BASE}` : TITULO_BASE;
      }

      // La vuelta ya esta hecha, haya llegado algo o no. Antes esto solo se
      // apagaba si en la PRIMERA vuelta habia algo sin leer, y con la bandeja
      // limpia al entrar —lo normal— la guarda seguia puesta y se tragaba el
      // primer mensaje que llegara, aunque fuera tres horas despues. Se vio en
      // el navegador: el numero subia en la pestaña y el aviso no salia.
      const eraLaPrimera = primera.current;
      primera.current = false;

      const u = d.ultimo;
      if (!u) { avisado.current = null; return; }
      // En la primera vuelta se toma nota y no se avisa: al entrar al CRM puede
      // haber cosas sin leer de ayer, y saltarian todas de golpe como si
      // acabaran de entrar.
      if (eraLaPrimera) { avisado.current = u.id; return; }
      if (avisado.current === u.id) return;
      avisado.current = u.id;

      // El aviso del sistema, solo si YA hay permiso. No se pide aqui: un
      // permiso que salta solo nada mas entrar se deniega por reflejo, y
      // entonces ya no se puede volver a pedir nunca. Se pide en Notificaciones.
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const quien = u.quien || 'Alguien';
      const cuerpo = u.texto || COMO_SE_DICE[u.tipo] || 'Te ha escrito';
      try {
        const aviso = new Notification(u.esGrupo ? `Mensaje en ${quien}` : `${quien} te ha escrito`, {
          body: cuerpo,
          // Por conversacion: si escribe tres veces seguidas se sustituye el
          // aviso en vez de apilar tres.
          tag: `wa-${u.conversacionId}`,
        });
        // Y al pulsarlo, SE ABRE ESE CHAT. Un aviso que no lleva a ninguna parte
        // obliga a buscar la conversacion a mano, que es justo el trabajo que
        // venia a ahorrar — y con la lista llena es donde mas se tarda.
        aviso.onclick = () => {
          window.focus();
          irAlChat.current(u.conversacionId);
          aviso.close();
        };
      } catch { /* si el navegador no deja, queda el numero en la pestaña */ }
    } catch { /* sin conexion se calla; la siguiente vuelta lo reintenta */ }
  }, []);

  useEffect(() => {
    if (apagado) return undefined;
    preguntar();
    const cada = enlazada ? CADA_ENLAZADA_MS : CADA_SIN_ENLAZAR_MS;
    const t = setInterval(preguntar, cada);
    return () => clearInterval(t);
  }, [preguntar, enlazada, apagado]);

  // Al salir, devolver el titulo: si no, la pestaña se queda con un «(3)»
  // pegado para siempre en el resto del CRM.
  useEffect(() => () => {
    if (typeof document !== 'undefined') document.title = TITULO_BASE;
  }, []);

  // No pinta nada: el aviso es del sistema y el contador va en la pestaña.
  return null;
}
