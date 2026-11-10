/**
 * Las pantallas de IA del propio CRM (#30, aquí #11): «Pregunta a tus datos» y
 * «Chat IA» (en MultiCRM también «Análisis IA», que ISEIE no tiene).
 *
 * Diego, 10/11/2026: el chatbot de IA del CRM ya no va, porque se usa Claude
 * por el MCP. Salen del menú y del buscador (Ctrl+K, que lee el menú), y su
 * dirección lleva al inicio. El código se queda —pantallas, rutas del servidor
 * y pruebas— por si un día se recupera. El MCP de Claude no depende de esto.
 *
 * Para volver a encenderlas, en un solo sitio: `VITE_PANTALLAS_IA=1` en el
 * `.env` del frontal y volver a construir. «Pregunta a tus datos» sigue además
 * detrás de `SOLO_EN_PRUEBAS`, y «Chat IA» vuelve como «Próximamente», como antes.
 */
export const PANTALLAS_IA = import.meta.env.VITE_PANTALLAS_IA === '1';

/** Las direcciones de esas pantallas. */
export const RUTAS_IA = ['/informes/preguntar', '/chat-ia'];
