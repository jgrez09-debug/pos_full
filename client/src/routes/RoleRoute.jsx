import { Navigate } from 'react-router-dom';
import { getUser } from '../utils/auth';

export default function RoleRoute({ allow, children }) {
  const u = getUser();
  if (!u) return <Navigate to="/login" replace />;
  if (allow && !allow.includes(u.rol)) return <Navigate to="/login" replace />;
  return children;
}
