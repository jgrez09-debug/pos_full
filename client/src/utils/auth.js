// Utilidades de auth en el front

export function getUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); }
  catch { return null; }
}

export function isAuthed() {
  const u = getUser();
  return !!(u && u.id);
}

export function defaultRouteFor(rol) {
  if (rol === 'mesero') return '/mesero';
  if (rol === 'cajero') return '/cajero';
  return '/cajero';
}

export function logout() {
  localStorage.removeItem('user');
  location.href = '/login';
}
