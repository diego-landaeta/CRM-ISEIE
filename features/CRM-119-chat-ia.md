# CRM-119 · Frontend chat IA con streaming + panel lateral

## Estado

- **Frontend:** completado (Angel) — modulo `frontend/src/modules/ai-chat/`
- **Backend:** pendiente (Diego) — Fase 3, `POST /api/claude/chat` con SSE

USE_MOCKS=true en [`claude-chat.api.js`](../../frontend/src/modules/ai-chat/api/claude-chat.api.js).

## Lo que entrega el frontend

- **FAB global** "Pregunta a Claude" abajo a la derecha (`<AIChatTrigger />`), montado en `AppLayout`
- **Panel lateral** 400px ancho desktop, full-width en mobile con backdrop oscuro
- **Streaming visible:** texto aparece progresivamente con cursor parpadeante (`<span animate-pulse>`)
- **3 botones quick questions:**
  - Resumen del mes
  - Leads sin actividad
  - Rendimiento campanas
- **Historial de conversacion** persistente durante la sesion (en memoria, no localStorage — segun spec Jira)
- **Markdown rendering** en respuestas (tablas, listas, bold, code) con `react-markdown` + `remark-gfm`
- **Cancelar streaming** en mid-respuesta con AbortController
- **Limpiar conversacion** con boton de refresh
- **Atajos:** Enter envia, Shift+Enter newline, Esc cierra panel
- **Auto-scroll** al fondo cuando llegan deltas
- **Disabled** input mientras hay streaming en curso

## Implementacion técnica

- **Streaming:** usa `fetch` con response body reader (no `EventSource`) — necesario para enviar headers de auth + body POST. Parsea lineas `data:` separadas por `\n\n`.
- **Mock streaming:** simulado con setTimeout 25-60ms entre chunks de 1-3 tokens para sensacion realista.
- **Hook `useClaudeChat(projectId)`:** state machine con array de mensajes + flag streaming + AbortController ref.
- **Tipo de evento SSE soportados:** `start`, `delta`, `done`, `error`.

## Contrato del endpoint

### `POST /api/claude/chat`

| Campo | Valor |
|-------|-------|
| Auth | Bearer token |
| Roles | superadmin, admin, gestor |
| Rate limit | 20 mensajes/hora/usuario |
| Response | `text/event-stream` |

**Body:** `{ message: string, projectId: number }`

**SSE events:**

```
data: {"type": "start", "messageId": "uuid"}
data: {"type": "delta", "content": "En marzo "}
data: {"type": "delta", "content": "2026, ..."}
data: {"type": "done", "messageId": "uuid", "usage": {"promptTokens": 1500, "completionTokens": 250}}
```

**Errores:**
- `429 RATE_LIMITED` — superado limite 20/h
- `400 MESSAGE_TOO_LONG`

**Notas backend:**
- Pre-cargar contexto del proyecto en el system prompt: leads recientes, conversiones, KPIs Meta+Google, GSC.
- Cachear contexto del proyecto por 5 minutos para no recalcularlo en cada mensaje del mismo usuario.
- Almacenar conversaciones en DB (tabla `ai_conversations` + `ai_messages`) para auditoria + posible historial cross-session futuro (CRM-119 v2).
- Streaming: enviar headings:
  ```
  Content-Type: text/event-stream
  Cache-Control: no-cache
  Connection: keep-alive
  X-Accel-Buffering: no  # Nginx
  ```
- Implementar abort: si el cliente cierra la conexion mid-stream, parar la llamada a Claude API para no malgastar tokens.

## Como activar cuando Diego termine

```diff
// frontend/src/modules/ai-chat/api/claude-chat.api.js
- const USE_MOCKS = true;
+ const USE_MOCKS = false;
```

El mismo flag controla streaming real vs mock.
