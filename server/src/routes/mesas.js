// server/src/routes/mesas.js (ESM)
import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

/** Listado de mesas */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, numero, estado FROM mesas ORDER BY numero`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Seleccionar/abrir precuenta (usado por Mesero) */
router.post('/:id/seleccionar', async (req, res) => {
  const { id } = req.params;
  const { mesero_id } = req.body;

  try {
    // 1) Si hay precuenta abierta/enviada para esa mesa, reusar (comportamiento actual)
    const { rows: ex } = await pool.query(
      `SELECT id FROM precuentas
        WHERE mesa_id=$1 AND estado IN ('abierta','enviada')
        ORDER BY creado_en DESC LIMIT 1`,
      [id]
    );
    if (ex.length) {
      // asegurar mesa 'ocupada' por consistencia (idempotente)
      await pool.query(
        `UPDATE mesas SET estado='ocupada', mesero_id=COALESCE(mesero_id,$2) WHERE id=$1`,
        [id, mesero_id]
      );
      return res.json({ precuenta_id: ex[0].id });
    }

    // 2) No hay precuenta activa: intentar tomar la mesa de forma atómica.
    //    Solo pasa a 'ocupada' si estaba 'libre'. Evita la carrera entre meseros.
    const claim = await pool.query(
      `UPDATE mesas
          SET estado='ocupada', mesero_id=$2
        WHERE id=$1 AND estado='libre'
        RETURNING id`,
      [id, mesero_id]
    );

    if (claim.rowCount === 0) {
      // Otro mesero la tomó entre el paso (1) y (2)
      return res.status(409).json({ error: 'La mesa ya fue tomada por otro mesero.' });
    }

    // 3) Crear precuenta nueva
    const { rows: ins } = await pool.query(
      `INSERT INTO precuentas (mesa_id, mesero_id, estado)
       VALUES ($1,$2,'abierta') RETURNING id`,
      [id, mesero_id]
    );

    return res.json({ precuenta_id: ins[0].id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** 🔹 Obtener la precuenta actual de una mesa (para Cajero) */
router.get('/:id/precuenta', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id
         FROM precuentas
        WHERE mesa_id=$1 AND estado IN ('abierta','enviada')
        ORDER BY creado_en DESC
        LIMIT 1`,
      [id]
    );
    res.json({ precuenta_id: rows[0]?.id ?? null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
