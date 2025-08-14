import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';

import { authRequired } from './middleware/auth.js';

import auth from './routes/auth.js';
import productos from './routes/productos.js';
import mesas from './routes/mesas.js';
import precuentas from './routes/precuentas.js';
import pagos from './routes/pagos.js';
import comandas from './routes/comandas.js';
import printjobs from './routes/printjobs.js';
import { roleRequired } from './middleware/auth.js';
import impresoras from './routes/impresoras.js';
import kds from './routes/kds.js'; // ← NUEVO

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

app.use('/api/login', auth); // pública
app.use('/api/impresoras', impresoras);

// protegidas por rol
app.use('/api/mesas',      authRequired, roleRequired('mesero','cajero'), mesas);
app.use('/api/precuentas', authRequired, roleRequired('mesero','cajero'), precuentas);
app.use('/api/productos',  authRequired, roleRequired('mesero','cajero'), productos);

// sólo cajero
app.use('/api/pagos',      authRequired, roleRequired('cajero'), pagos);
app.use('/api/comandas',   authRequired, roleRequired('cajero'), comandas);
app.use('/api/print-jobs', authRequired, roleRequired('cajero'), printjobs);

// KDS: cajero o usuario con rol dedicado 'kds'
app.use('/api/kds',        authRequired, roleRequired('cajero','kds'), kds);

const port = Number(process.env.PORT || 3001);
app.listen(port, '0.0.0.0', () => console.log(`API en http://0.0.0.0:${port}`));
