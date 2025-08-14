import { Navigate } from "react-router-dom";

/**
 * Decide adónde enviar al usuario según su rol.
 * - Sin sesión -> /login
 * - "cajero" -> /cajero
 * - "kds"/"cocina"/"barra" -> /kds
 * - por defecto -> /mesero
 */
export default function HomeRedirect() {
  const u = readUser();
  if (!u || !u.id) return <Navigate to="/login" replace />;

  const role = String(u.rol || u.role || u.perfil || "").toLowerCase();
  if (role === "cajero") return <Navigate to="/cajero" replace />;
  if (["kds", "cocina", "barra"].includes(role)) return <Navigate to="/kds" replace />;
  return <Navigate to="/mesero" replace />;
}

function readUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
}
