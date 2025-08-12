const API_URL = `${window.location.protocol}//${window.location.hostname}:3001`;

export async function api(path, { method='GET', body, headers } = {}) {
  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const token = localStorage.getItem('token');

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (!location.pathname.startsWith('/login')) location.href = '/login';
    throw new Error('Sesión expirada');
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { throw new Error(text || 'Respuesta no JSON'); }
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

export const API_BASE = API_URL;
