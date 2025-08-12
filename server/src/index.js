// server/src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';

import { authRequired, roleRequired } from './middleware/auth.js';

import auth from './routes/auth.js';
import productos from './routes/productos.js';
import mesas from './routes/mesas.js';
import precuentas from './routes/precuentas.js';
import pagos from './routes/pagos.js';
import comandas from './routes/comandas.js';
import printjobs from './routes/printjobs.js';
import impresoras from './routes/impresoras.js';

const app = express();

// Middleware base
app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Healthcheck
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Rutas públicas
app.use('/api/login', auth);
app.use('/api/impresoras', impresoras);

// Rutas protegidas (mesero/cajero)
app.use('/api/mesas',      authRequired, roleRequired('mesero', 'cajero'), mesas);
app.use('/api/precuentas', authRequired, roleRequired('mesero', 'cajero'), precuentas);
app.use('/api/productos',  authRequired, roleRequired('mesero', 'cajero'), productos);

// Sólo cajero
app.use('/api/pagos',      authRequired, roleRequired('cajero'), pagos);
app.use('/api/comandas',   authRequired, roleRequired('cajero'), comandas);
app.use('/api/print-jobs', authRequired, roleRequired('cajero'), printjobs);

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Not Found: ${req.method} ${req.originalUrl}` });
});

// Handler de errores
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, '0.0.0.0', () => {
  console.log(`API en http://0.0.0.0:${port}`);
});
