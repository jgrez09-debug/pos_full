import { pool } from '../db.js';

export async function buildPrecuentaPayload(precuentaId) {
  const { rows: [h] } = await pool.query(
    `SELECT p.id, p.propina_porcentaje, p.propina_monto, p.total_sin_propina, p.total_con_propina,
            m.numero AS mesa, u.nombre_completo AS mesero, p.creado_en
       FROM precuentas p
       JOIN mesas m ON m.id = p.mesa_id
       JOIN usuarios u ON u.id = p.mesero_id
      WHERE p.id=$1`, [precuentaId]
  );
  if (!h) throw new Error('Precuenta no existe');

  const { rows: detalle } = await pool.query(
    `SELECT descripcion, cantidad, precio, total_linea
       FROM vw_precuenta_detalle_ordenado
      WHERE precuenta_id=$1
      ORDER BY orden_interno, orden_tipo, line_id`, [precuentaId]
  );

  return {
    tipo: 'ticket_precuenta',
    header: {
      numero: h.numero,                      // <--- agregado
      mesa: h.mesa,
      mesero: h.mesero,
      fecha: new Date(h.creado_en).toISOString().slice(0,19).replace('T',' ')
    },
    lineas: detalle.map(d => ({
      desc: d.descripcion,
      cant: d.cantidad,
      precio: Number(d.precio),
      total: Number(d.total_linea)
    })),
    totales: {
      subtotal: Number(h.total_sin_propina),
      propina_pct: Number(h.propina_porcentaje),
      propina: Number(h.propina_monto),
      total: Number(h.total_con_propina)
    }
  };
}
