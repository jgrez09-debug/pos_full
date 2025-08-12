import React from 'react';
import { Navigate } from 'react-router-dom';

function getSesion() {
  try {
    const raw = localStorage.getItem('sesion');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Protege una ruta y (opcionalmente) valida el rol.
 * - Si no hay sesión -> vuelve a "/"
 * - Si hay rolPermitido y no coincide -> vuelve a "/"
 */
export default function PrivateRoute({ children, rolPermitido }) {
  const sesion = getSesion();
  const rol = sesion?.usuario?.rol;

  if (!rol) return <Navigate to="/" replace />;
  if (rolPermitido && rol !== rolPermitido) return <Navigate to="/" replace />;

  return children;
}
