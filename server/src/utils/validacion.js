import { pool } from '../db.js';

export async function acompPermitido(productoId, acompId) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM producto_acompanamiento
      WHERE producto_id=$1 AND acompanamiento_id=$2`,
    [productoId, acompId]
  );
  return rowCount > 0;
}
