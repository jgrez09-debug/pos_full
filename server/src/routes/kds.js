// server/src/routes/kds.js
// KDS: listar y actualizar estado de tickets e ítems (por-ítem)
import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

function mapItem(r) {
  return {
    id: Number(r.item_id),
    ticket_id: Number(r.ticket_id),
    cantidad: Number(r.cantidad || 1), // será 1 si guardamos “unitarizado”
    producto: r.producto,
    nota: r.nota || '',
    acomp: Array.isArray(r.acomp) ? r.acomp : JSON.parse(r.acomp || '[]'),
    estado: r.estado, // pendiente | preparando | listo
  };
}

function mapTicket(r) {
  return {
    id: Number(r.id),
    precuenta_id: r.precuenta_id,
    pre_numero: r.pre_numero != null ? Number(r.pre_numero) : null, // ← agregado
    mesa_numero: Number(r.mesa_numero),
    sector: r.sector,
    estado: r.estado, // pendiente | preparando | listo (del ticket general)
    mesero_nombre: r.mesero_nombre || '',
    creado_en: r.creado_en,
    actualizado_en: r.actualizado_en,
    edad_seg: Number(r.edad_seg),
    items: Array.isArray(r.items) ? r.items : JSON.parse(r.items || '[]'),
  };
}

// útil para probar conectividad / auth
router.get('/ping', (_req, res) => res.json({ ok: true, now: new Date().toISOString() }));

/**
 * GET /api/kds
 * Devuelve tickets abiertos con sus ítems (cada ítem puede tener su propio estado).
 * Ahora incluye `pre_numero` (número de la precuenta) vía subconsulta segura.
 */
router.get('/', async (_req, res) => {
  try {
    const q = await pool.query(`
      SELECT
        t.id,
        t.precuenta_id,
        (SELECT numero FROM precuentas p WHERE p.id = t.precuenta_id) AS pre_numero,  -- ← agregado
        t.mesa_numero,
        t.sector,
        t.estado,
        t.mesero_nombre,
        t.creado_en,
        t.actualizado_en,
        EXTRACT(EPOCH FROM (now() - t.creado_en))::int AS edad_seg,
        COALESCE(
          json_agg(
            json_build_object(
              'item_id', ki.id,
              'ticket_id', ki.ticket_id,
              'cantidad', ki.cantidad,
              'producto', ki.producto,
              'nota', ki.nota,
              'acomp', ki.acomp,
              'estado', ki.estado
            )
          ) FILTER (WHERE ki.id IS NOT NULL),
          '[]'
        ) AS items
      FROM kds_tickets t
      LEFT JOIN kds_items ki ON ki.ticket_id = t.id
      WHERE t.estado IN ('pendiente','preparando')
      GROUP BY t.id
      ORDER BY t.creado_en ASC;
    `);
    res.json({ ok: true, data: q.rows.map(mapTicket) });
  } catch (e) {
    console.error('KDS list error:', e);
    res.status(500).json({ ok: false, error: 'No se pudo listar KDS' });
  }
});

/**
 * PATCH /api/kds/tickets/:id
 * Cambia el estado general del ticket (por si quieres “Listo todo”)
 */
router.patch('/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body || {};
  const allowed = ['pendiente', 'preparando', 'listo'];
  if (!allowed.includes(String(estado))) {
    return res.status(400).json({ ok: false, error: 'estado inválido' });
  }
  try {
    const r = await pool.query(
      `UPDATE kds_tickets
         SET estado = $2, actualizado_en = now()
       WHERE id = $1
       RETURNING id, estado`,
      [id, estado]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'ticket no encontrado' });
    res.json({ ok: true, ticket: r.rows[0] });
  } catch (e) {
    console.error('KDS update ticket error:', e);
    res.status(500).json({ ok: false, error: 'No se pudo actualizar el ticket' });
  }
});

/**
 * PATCH /api/kds/items/:id
 * Cambia el estado de UN ÍTEM (lo que necesitas para botones por-ítem)
 */
router.patch('/items/:id', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body || {};
  const allowed = ['pendiente', 'preparando', 'listo'];
  if (!allowed.includes(String(estado))) {
    return res.status(400).json({ ok: false, error: 'estado inválido' });
  }
  try {
    const r = await pool.query(
      `UPDATE kds_items
         SET estado = $2
       WHERE id = $1
       RETURNING id, ticket_id, estado`,
      [id, estado]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'ítem no encontrado' });

    // Si todos los ítems del ticket quedaron 'listo', marcamos el ticket 'listo'
    const { ticket_id } = r.rows[0];
    const all = await pool.query(
      `SELECT bool_and(estado='listo') AS todos_listos
         FROM kds_items WHERE ticket_id=$1`,
      [ticket_id]
    );
    if (all.rows[0]?.todos_listos) {
      await pool.query(
        `UPDATE kds_tickets SET estado='listo', actualizado_en=now() WHERE id=$1`,
        [ticket_id]
      );
    }

    res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    console.error('KDS update item error:', e);
    res.status(500).json({ ok: false, error: 'No se pudo actualizar el ítem' });
  }
});

export default router;
