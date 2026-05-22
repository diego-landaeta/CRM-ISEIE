// Parser de emails inbound (Cloudflare Email Routing, Brevo Inbound, Mailgun, SendGrid).
// Convierte el body del email (text o html) en un objeto { Label: Value }
// que el auto-detect de field-aliases puede mapear a campos del lead.
//
// Soporta los formatos típicos que generan los plugins de WordPress:
//   - Elementor Pro Forms: HTML table con <td>Label</td><td>Value</td>
//   - Contact Form 7: text plano "Label: Value"
//   - WPForms: HTML similar a Elementor
//   - Gravity Forms: HTML con divs

const FROM_PATTERNS = [
  // Cloudflare Email Routing webhook
  { keys: ['from', 'subject', 'html', 'text', 'headers'] },
  // Brevo Inbound
  { keys: ['Sender', 'Subject', 'BodyHtml', 'BodyText', 'Headers'] },
  // Mailgun Routes
  { keys: ['from', 'subject', 'body-html', 'body-plain', 'message-headers'] },
  // SendGrid Inbound Parse
  { keys: ['from', 'subject', 'html', 'text', 'envelope'] },
];

// Normaliza payload de cualquier proveedor a { from, subject, html, text, headers }
export function normalizeEmailPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    from: payload.from || payload.Sender || payload.sender || payload.From || '',
    subject: payload.subject || payload.Subject || payload['Subject'] || '',
    html: payload.html || payload.BodyHtml || payload['body-html'] || payload.HtmlBody || '',
    text: payload.text || payload.BodyText || payload['body-plain'] || payload.TextBody || '',
    headers: payload.headers || payload.Headers || payload['message-headers'] || {},
  };
}

// Extrae { Label: Value } del cuerpo HTML buscando tablas y pares clave-valor
export function parseHtmlBody(html) {
  if (!html || typeof html !== 'string') return {};
  const result = {};

  // 1. Tablas <tr><td>Label</td><td>Value</td></tr>  (Elementor, WPForms)
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      cells.push(stripTags(tdMatch[1]).trim());
    }
    if (cells.length >= 2 && cells[0] && cells[1]) {
      const label = cells[0].replace(/[:\s]+$/, '').trim();
      if (label && !result[label]) result[label] = cells[1];
    }
  }

  // 2. Divs/spans con label-valor explícito (algunos themes)
  // <div class="field"><strong>Label:</strong> Value</div>
  const labelValRegex = /<(?:strong|b)[^>]*>([^<]+?):\s*<\/(?:strong|b)>\s*([^<]+?)(?=<|$)/gi;
  let lvMatch;
  while ((lvMatch = labelValRegex.exec(html)) !== null) {
    const label = lvMatch[1].trim();
    const value = lvMatch[2].trim();
    if (label && value && !result[label]) result[label] = value;
  }

  // 3. Si no se obtuvo nada, fallback al text-mode sobre el HTML stripped
  if (Object.keys(result).length === 0) {
    return parseTextBody(stripTags(html));
  }
  return result;
}

// Extrae { Label: Value } del texto plano buscando "Label: Value" línea por línea
export function parseTextBody(text) {
  if (!text || typeof text !== 'string') return {};
  const result = {};
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // "Label: Value" — el separador es ":" o "—"
    const m = line.match(/^([^:]{1,80}?)\s*[:—]\s*(.+)$/);
    if (m) {
      const label = m[1].trim();
      const value = m[2].trim();
      if (label && value && !result[label]) result[label] = value;
    }
  }
  return result;
}

// Quita tags HTML y decodifica entities básicas
function stripTags(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

// Extrae email del campo "From" del header (formato: "Nombre <email@x.com>" o "email@x.com")
export function extractFromEmail(fromHeader) {
  if (!fromHeader) return null;
  const m = String(fromHeader).match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  const cleanMatch = String(fromHeader).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return cleanMatch ? cleanMatch[0].toLowerCase() : null;
}

// Pipeline completo: payload bruto → { Label: Value } extraído del email
export function parseInboundEmail(rawPayload) {
  const email = normalizeEmailPayload(rawPayload);
  if (!email) return { fields: {}, meta: {} };

  // Preferir HTML, fallback a text
  let fields = email.html ? parseHtmlBody(email.html) : parseTextBody(email.text);

  // Si HTML no extrajo nada útil, intentar text
  if (Object.keys(fields).length === 0 && email.text) {
    fields = parseTextBody(email.text);
  }

  // Si tampoco hay fields explícitos, al menos guardar el From como email del lead
  const senderEmail = extractFromEmail(email.from);
  if (!fields.email && !fields.Email && senderEmail) {
    fields.email = senderEmail;
  }

  return {
    fields,
    meta: {
      from: email.from,
      subject: email.subject,
      sender_email: senderEmail,
    },
  };
}
