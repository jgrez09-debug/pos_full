// server/src/routes/pagos.js
import { Router } from 'express';
import { pool } from '../db.js';
import { recalcPrecuenta } from '../utils/totales.js';
import { generarComandas } from '../utils/comandas.js';

const router = Router();

// Pagar precuenta -> registra pago, genera comandas por sector, libera mesa
router.post('/:precuentaId', async (req, res) => {
  const { precuentaId } = req.params;
  // del front pueden venir '' -> convierte a 0
  const cajero_id = Number(req.body.cajero_id);
  const tipo = String(req.body.tipo || 'mixto');
  const monto_efectivo = Number(req.body.monto_efectivo || 0);
  const monto_tarjeta  = Number(req.body.monto_tarjeta  || 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Recalcular totales
    const tot = await recalcPrecuenta(precuentaId);
    const monto_total = Number(tot.total_con_propina || 0);
    const suma = monto_efectivo + monto_tarjeta;
    if (suma < monto_total) throw new Error('Monto insuficiente');

    const detalleObj = { vueltos: suma - monto_total, medio: tipo };

    // ⚠️ Serializa y castea a jsonb
    await client.query(
      `INSERT INTO pagos
         (precuenta_id, cajero_id, tipo, monto_total, monto_efectivo, monto_tarjeta, detalle)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        precuentaId,
        cajero_id,
        tipo,
        monto_total,
        monto_efectivo,
        monto_tarjeta,
        JSON.stringify({ vueltos: suma - monto_total, medio: tipo }) // <—
      ]
    );

    // Generar comandas por sector (BARRA/COCINA1/COCINA2)
    await generarComandas(precuentaId, client);

    // Marcar precuenta pagada y liberar mesa
    await client.query(`UPDATE precuentas SET estado='pagada' WHERE id=$1`, [precuentaId]);
    await client.query(
      `UPDATE mesas SET estado='libre'
         WHERE id = (SELECT mesa_id FROM precuentas WHERE id=$1)`,
      [precuentaId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, total_cobrado: monto_total, vueltos: suma - monto_total });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;
