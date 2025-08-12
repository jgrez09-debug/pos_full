// server/src/routes/comandas.js  (ESM)
import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

/**
 * GET /api/comandas/cola?sector=BARRA
 * Devuelve hasta 10 comandas en cola para el sector indicado.
 */
router.get('/cola', async (req, res) => {
  const { sector } = req.query;
  if (!sector) return res.status(400).json({ error: 'Falta sector' });

  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.impresora_nombre, c.cuerpo, c.creado_en
         FROM comandas c
         JOIN sectores_impresion s ON s.id = c.sector_id
        WHERE s.nombre = $1 AND c.estado = 'en_cola'
        ORDER BY c.creado_en ASC
        LIMIT 10`,
      [sector]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/comandas/:id/marcar-impresa
 * Marca comanda como impresa.
 */
router.post('/:id/marcar-impresa', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE comandas
          SET estado = 'impresa', impreso_en = NOW()
        WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
