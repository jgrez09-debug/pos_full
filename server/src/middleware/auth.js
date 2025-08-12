// Middleware de protección con JWT (ESM)
import jwt from 'jsonwebtoken';

export function authRequired(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, rol, nombre }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida/expirada' });
  }
}
export function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user?.rol || !roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'Prohibido' });
    }
    next();
  };
}
