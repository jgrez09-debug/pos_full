// src/RoleRoute.jsx
import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

function getUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); }
  catch { return null; }
}

export default function RoleRoute({ allow = [] }) {
  const user = getUser();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const role = user.rol || user.role;
  if (allow.length && !allow.includes(role)) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
