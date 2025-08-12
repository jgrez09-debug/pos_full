// server/src/middlewares/printerAuth.js
export function printerAuth(req, res, next) {
  // Si no hay token configurado, NO bloqueamos (modo dev).
  const required = process.env.PRINT_AGENT_TOKEN;
  if (!required) return next();

  const got = req.headers['x-printer-token'];
  if (got && got === required) return next();

  return res.status(401).json({ error: 'Printer agent unauthorized' });
}
