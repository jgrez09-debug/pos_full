// client/src/utils/api.js
const API_URL = 'http://192.168.1.90:3001/api';

export default async function api(path, options = {}) {
  const { method = 'GET', body, headers = {} } = options;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // si no es 2xx, lanzo error con texto del backend
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { error: text }; }
  if (!res.ok) {
    const msg = json?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}
