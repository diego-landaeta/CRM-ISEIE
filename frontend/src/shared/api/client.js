export const APP_BASE_URL = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
export const API_BASE_URL = `${APP_BASE_URL}/api`;

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Token en memoria (NO localStorage por seguridad)
let accessToken = null;
let onAuthFailure = null; // callback para logout en caso de fallo total

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setOnAuthFailure(cb) {
  onAuthFailure = cb;
}

// Reintento automático ante 502/503/504 (nginx upstream caído brevemente
// durante deploys de PM2). 2 reintentos con backoff lineal — evita que el
// usuario vea errores transitorios de 1-2s.
async function fetchWithRetry(fullUrl, fetchOpts, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(fullUrl, fetchOpts);
      // Si la respuesta es 502/503/504 reintentamos
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      // network error (fetch rejected) → también reintentar
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('fetch failed after retries');
}

async function request(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData
    ? { ...options.headers }
    : { 'Content-Type': 'application/json', ...options.headers };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  // Soporte axios-style `params`: { params: { foo: 1, bar: undefined } }
  // → URL?foo=1 (omite undefined/null/'').
  let finalUrl = url;
  if (options.params && typeof options.params === 'object') {
    const qs = Object.entries(options.params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) finalUrl += (finalUrl.includes('?') ? '&' : '?') + qs;
  }
  const { params: _omit, ...fetchOptions } = options;

  const res = await fetchWithRetry(`${API_BASE_URL}${finalUrl}`, {
    credentials: 'include',
    ...fetchOptions,
    headers,
  });

  // Refresh token on 401 — pero no para login/refresh (su 401 = credenciales incorrectas)
  const isAuthEndpoint = url === '/auth/login' || url === '/auth/refresh';
  if (res.status === 401 && !options._retry && !isAuthEndpoint) {
    try {
      const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        accessToken = refreshData.data.accessToken;
        return request(url, { ...options, _retry: true });
      }
    } catch { /* ignore refresh error */ }
    // Refresh tambien fallo — sesion expirada
    accessToken = null;
    if (onAuthFailure) onAuthFailure();
    throw new ApiError('Session expired', 401);
  }

  const data = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    const msg = data?.error || data?.message || (res.status === 401 ? 'Credenciales incorrectas' : `Error ${res.status}`);
    throw new ApiError(msg, res.status, data);
  }

  return data;
}

const client = {
  get: (url, options) => request(url, { method: 'GET', ...options }),
  post: (url, body, options) => request(url, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body), ...options }),
  patch: (url, body, options) => request(url, { method: 'PATCH', body: body instanceof FormData ? body : JSON.stringify(body), ...options }),
  put: (url, body, options) => request(url, { method: 'PUT', body: body instanceof FormData ? body : JSON.stringify(body), ...options }),
  delete: (url, optionsOrBody) => {
    // Acepta el patron de axios: delete(url, { data: {...} }) para mandar body
    const opts = optionsOrBody || {};
    const hasBody = opts.data !== undefined;
    return request(url, {
      method: 'DELETE',
      ...(hasBody ? { body: JSON.stringify(opts.data) } : {}),
      ...opts,
    });
  },
  upload: async (url, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${API_BASE_URL}${url}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data?.error || `Error ${res.status}`, res.status, data);
    }
    return res.json();
  },
};

export default client;
