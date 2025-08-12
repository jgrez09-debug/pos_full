// src/RoleRoute.jsx
import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

export default function RoleRoute({ allow = [] }) {
  const user = getUser();
  const location = useLocation();

  // No autenticado: enviar a login y recordar desde dónde venía
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Validar rol
  const role = user.rol || user.role; // por si viene como 'role'
  const ok = allow.length === 0 || allow.includes(role);

  if (!ok) {
    // Sin permiso: puedes redirigir a una pantalla 403 si la tienes
    return <Navigate to="/login" replace />;
  }

  // Permitir acceso a la ruta hija
  return <Outlet />;
}
