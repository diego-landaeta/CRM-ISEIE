import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
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

// Sin roleGuard a proposito: esta pantalla es de las gestoras. El recorte va en
// el controlador, que a un gestor le fuerza su propio responsableId y solo le
// enseña las plantillas compartidas mas las suyas.
router.get('/templates', ctrl.listTemplates);
router.post('/templates', ctrl.createTemplate);
router.patch('/templates/:id', ctrl.updateTemplate);
router.delete('/templates/:id', ctrl.deleteTemplate);

router.get('/cola', ctrl.cola);
router.get('/sala', ctrl.sala);

// El panel del equipo. El recorte va en el controlador —solo admin— igual que
// el resto del modulo.
router.get('/equipo', ctrl.equipo);
router.post('/equipo/:userId/abrir', ctrl.abrirSala);
router.post('/equipo/:userId/latido', ctrl.latido);

// ── El chat ──────────────────────────────────────────────────────────────────
// Las conversaciones ahora viven en el CRM, no en un navegador remoto: por eso
// se pueden listar, buscar y atar a la ficha del lead.
// De quien puedo ver el WhatsApp. Para una gestora devuelve solo a ella misma:
// el recorte lo hace el controlador, no la pantalla.
router.get('/usuarios', chat.usuarios);

router.get('/chats', chat.chats);
router.post('/chats', chat.abrirChat);
router.get('/chats/:id', chat.chat);
router.post('/chats/:id/enviar', chat.enviar);
router.post('/chats/:id/adjunto', uploadWhatsapp.single('archivo'), chat.adjunto);
router.post('/chats/:id/no-escribir', chat.noEscribir);
router.post('/mensajes/:id/descargar', chat.descargarAdjunto);
router.get('/conexion', chat.conexion);
router.get('/sincronizacion', chat.sincronizacion);
router.post('/reintentar-archivos', chat.reintentarArchivos);
router.post('/emparejar', chat.emparejar);
router.post('/desconectar', chat.desconectar);

export default router;
