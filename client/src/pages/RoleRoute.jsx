import { Navigate } from "react-router-dom";

/**
 * Protege una ruta por rol.
 * - Sin sesión -> /login
 * - Con sesión pero sin rol permitido -> redirige a "/"
 */
export default function RoleRoute({ allow = [], children }) {
  const user = getUser();
  if (!user?.id) return <Navigate to="/login" replace />;

  const role = String(user.rol || user.role || user.perfil || "").toLowerCase();
  const allowed = allow.map((r) => String(r).toLowerCase());

  if (allowed.length > 0 && !allowed.includes(role)) {
    // vuelve a la raíz; allí HomeRedirect manda a la vista correcta
    return <Navigate to="/" replace />;
  }
  return children;
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
}
