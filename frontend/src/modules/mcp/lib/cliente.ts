/**
 * El User-Agent de quien llamó al MCP, dicho en cristiano. Lo usan la tabla de
 * URLs (#194) y la Actividad (#195): en UN sitio, para que las dos digan lo
 * mismo del mismo cliente.
 */
export function nombreDelCliente(ua: string | null | undefined): string {
  if (!ua) return '';
  if (/^claude-code\//i.test(ua)) return 'Claude Code';
  if (/Claude-User|Anthropic|python-httpx/i.test(ua)) return 'Claude Desktop / claude.ai';
  if (/mcp-remote|node/i.test(ua)) return 'Claude Desktop (archivo de configuración)';
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
}
