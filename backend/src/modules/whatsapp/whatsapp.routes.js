import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { uploadWhatsapp } from '../../shared/middleware/upload.js';
import * as ctrl from './whatsapp.controller.js';
import * as chat from './chat.controller.js';

const router = Router();

// El webhook de Evolution va ANTES del verifyToken: quien llama es el
// contenedor de WhatsApp, no un navegador con sesion. Se protege con un
// secreto compartido y porque Evolution solo escucha en 127.0.0.1.
router.post('/webhook', chat.webhook);

// Los adjuntos van tambien antes del verifyToken: los pide el navegador desde
// un <img> o un <audio>, que no mandan cabeceras. Lo que autoriza es la firma
// temporal de la propia direccion.
router.get('/media/:mensajeId', chat.verMedia);

router.use(verifyToken);

// Su WhatsApp o el de otra persona (#423): la ruta deja pasar con cualquiera de
// los dos y el controlador decide cuál hace falta. Sin ninguno, el aviso de
// siempre, no el 403 genérico.
const usaOSupervisa = puede('whatsapp.usar', 'whatsapp.supervisar', {
  mensaje: 'No tienes activado el WhatsApp del CRM. Lo enciende quien administra, en tu ficha de usuario.',
  code: 'SIN_WHATSAPP',
});

// Sin roleGuard a proposito: esta pantalla es de las gestoras. El recorte va en
// el controlador, que a un gestor le fuerza su propio responsableId y solo le
// enseña las plantillas compartidas mas las suyas.
router.get('/templates', puede('whatsapp.plantillas'), ctrl.listTemplates);
router.post('/templates', puede('whatsapp.plantillas'), ctrl.createTemplate);
router.patch('/templates/:id', puede('whatsapp.plantillas'), ctrl.updateTemplate);
router.delete('/templates/:id', puede('whatsapp.plantillas'), ctrl.deleteTemplate);

router.get('/cola', puede('whatsapp.cola'), ctrl.cola);
// Si cada gestora responde en WhatsApp y lo que apunta (30/10). Para quien ve Reportes.
router.get('/actividad', puede('reports.view'), ctrl.actividad);

// Aqui vivian /sala y /equipo: el panel que abria la sesion de cada gestora en
// un navegador remoto. Ese metodo se retiro —contenedores borrados y servicio
// apagado— y la pantalla seguia existiendo, asi que quien llegaba a ella veia
// «no hay gestor de salas configurado» y creia que el modulo estaba roto.
// Ahora todo pasa por Evolution: para ver el WhatsApp de otra persona esta el
// selector del Chat, que pregunta por usuarioId.

// ── El chat ──────────────────────────────────────────────────────────────────
// Las conversaciones ahora viven en el CRM, no en un navegador remoto: por eso
// se pueden listar, buscar y atar a la ficha del lead.
// De quien puedo ver el WhatsApp. Para una gestora devuelve solo a ella misma:
// el recorte lo hace el controlador, no la pantalla.
router.get('/usuarios', chat.usuarios);

// El banco de mensajes (#101). Va ANTES de las rutas de chats para leerse
// junto: no es el chat, es el respaldo.
// La forma de los avisos de Evolution. Solo soporte y superadmin: no lleva
// datos de nadie, pero dice como esta montado el sistema por dentro.
router.get('/forma-avisos', puede('whatsapp.forma_avisos'), chat.formaDeAvisos);
router.delete('/forma-avisos', puede('whatsapp.forma_avisos'), chat.olvidarFormaDeAvisos);

router.get('/banco', usaOSupervisa, chat.banco);
router.get('/banco/numeros', usaOSupervisa, chat.bancoNumeros);

// Las etiquetas de WhatsApp de esta sesion (#128, #138). Son las del movil de
// la gestora, no el estado del prospecto que filtra la lista.
router.get('/etiquetas', usaOSupervisa, chat.etiquetasDeWhatsapp);

router.get('/chats', usaOSupervisa, chat.chats);
router.post('/chats', usaOSupervisa, chat.abrirChat);
router.get('/chats/:id', usaOSupervisa, chat.chat);
router.get('/chats/:id/ficha', usaOSupervisa, chat.ficha);
router.post('/chats/:id/enviar', usaOSupervisa, chat.enviar);
router.post('/chats/:id/adjunto', usaOSupervisa, uploadWhatsapp.single('archivo'), chat.adjunto);
router.post('/chats/:id/historial', usaOSupervisa, chat.traerHistorial);
router.post('/chats/:id/reenviar', usaOSupervisa, chat.reenviar);
router.post('/chats/:id/no-escribir', usaOSupervisa, chat.noEscribir);
// Llamar se hace desde el movil; el CRM solo lo apunta.
router.post('/chats/:id/etiqueta', usaOSupervisa, chat.etiquetarChat);
router.post('/chats/:id/llamada', usaOSupervisa, chat.registrarLlamada);
router.post('/mensajes/:id/descargar', usaOSupervisa, chat.descargarAdjunto);
// Corregir un mensaje ya enviado. WhatsApp deja 15 minutos (#75).
router.patch('/mensajes/:id', usaOSupervisa, chat.editarMensaje);
router.get('/conexion', usaOSupervisa, chat.conexion);
router.get('/sincronizacion', usaOSupervisa, chat.sincronizacion);
router.post('/reintentar-archivos', usaOSupervisa, chat.reintentarArchivos);
router.post('/emparejar', usaOSupervisa, chat.emparejar);
router.post('/desconectar', usaOSupervisa, chat.desconectar);
// Que se le contesta a quien llama. Por sesion: no todas la quieren.
// Lo consulta todo el CRM, no solo la pantalla de WhatsApp. No toca la base.
router.get('/sonando', chat.sonando);
// Lo que ha entrado y nadie ha leido, para avisar desde cualquier pantalla.
router.get('/sin-leer', usaOSupervisa, chat.sinLeer);
router.get('/respuesta-llamada', usaOSupervisa, chat.respuestaLlamada);
router.post('/respuesta-llamada', usaOSupervisa, chat.guardarRespuestaLlamada);

export default router;
