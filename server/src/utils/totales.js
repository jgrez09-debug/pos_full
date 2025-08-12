import { pool } from '../db.js';

export async function recalcPrecuenta(precuentaId) {
  const { rows: items } = await pool.query(
    `SELECT id, subtotal FROM precuenta_items WHERE precuenta_id = $1`,
    [precuentaId]
  );
  const { rows: extras } = await pool.query(
    `SELECT subtotal_extra FROM precuenta_item_acompanamientos pia
     JOIN precuenta_items pi ON pi.id = pia.precuenta_item_id
     WHERE pi.precuenta_id = $1`, [precuentaId]
  );

  const totalSin = items.reduce((a,r)=>a+Number(r.subtotal),0) +
                   extras.reduce((a,r)=>a+Number(r.subtotal_extra),0);

  // obtener % propina actual
  const { rows: [p] } = await pool.query(
    `SELECT propina_porcentaje FROM precuentas WHERE id = $1`, [precuentaId]
  );
  const propPerc = Number(p?.propina_porcentaje ?? 10);
  const propina = Math.round(totalSin * (propPerc/100));
  const totalCon = totalSin + propina;

  await pool.query(
    `UPDATE precuentas
       SET total_sin_propina=$2, propina_monto=$3, total_con_propina=$4
     WHERE id=$1`,
    [precuentaId, totalSin, propina, totalCon]
  );

  return { total_sin_propina: totalSin, propina_monto: propina, total_con_propina: totalCon };
}
