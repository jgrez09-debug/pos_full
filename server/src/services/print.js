// server/src/services/print.js
import { pool } from '../db.js';

/**
 * Encola una impresión en print_jobs, resolviendo la impresora desde rutas_impresion.
 * @param {string} canal - p.ej. 'ticket_precuenta', 'comanda_cocina', etc.
 * @param {object} payload - cuerpo JSON con los datos de lo que se va a imprimir
 * @returns {Promise<number>} id del job insertado
 */
export async function enqueuePrint(canal, payload) {
  // 1) Resuelve impresora para el canal
  const { rows } = await pool.query(
    `SELECT impresora_nombre
       FROM rutas_impresion
      WHERE canal = $1
      LIMIT 1`,
    [canal]
  );

  const impresora = rows[0]?.impresora_nombre || null;

  if (!impresora) {
    const err = new Error(
      'No hay impresora por defecto (CAJA) activa. ' +
      'Configura una impresora o ruteo para el canal "' + canal + '".'
    );
    err.status = 400;
    throw err;
  }

  // 2) Inserta job en cola
  const { rows: ins } = await pool.query(
    `INSERT INTO print_jobs (tipo, impresora_nombre, cuerpo)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id`,
    [canal, impresora, JSON.stringify(payload)]
  );

  return ins[0].id;
}
