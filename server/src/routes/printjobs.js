// server/src/routes/printjobs.js
import { Router } from 'express';
import { pool } from '../db.js';
import { printerAuth } from '../middleware/printerAuth.js';

const router = Router();

/**
 * GET /api/print-jobs/pending?impresora=CAJA
 * Devuelve trabajos pendientes para esa impresora.
 */
router.get('/pending', printerAuth, async (req, res) => {
  try {
    const impresora = String(req.query.impresora || '').trim();
    if (!impresora) return res.status(400).json({ error: 'impresora requerida' });

    const { rows } = await pool.query(
      `SELECT id, tipo, cuerpo, creado_en
         FROM print_jobs
        WHERE impresora_nombre = $1
          AND estado IS DISTINCT FROM 'impreso'
        ORDER BY creado_en ASC
        LIMIT 20`,
      [impresora]
    );

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/print-jobs/:id/ack
 * Marca un job como impreso (ok:true) o con error (ok:false, error:'...').
 */
router.post('/:id/ack', printerAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { ok, error } = req.body || {};

    await pool.query(
      `UPDATE print_jobs
          SET estado = $2,
              error = CASE WHEN $3 IS NULL THEN error ELSE $3 END,
              actualizado_en = NOW()
        WHERE id = $1`,
      [id, ok ? 'impreso' : 'error', ok ? null : String(error || 'error')]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
