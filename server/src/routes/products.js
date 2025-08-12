const express = require('express');
const router = express.Router();
const pool = require('../db');

/** Lista productos activos */
router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.nombre, p.precio, p.permite_acomps, p.max_acomps, s.nombre AS sector
     FROM productos p
     LEFT JOIN sectores s ON s.id = p.sector_id
     WHERE p.activo = TRUE
     ORDER BY p.nombre`
  );
  res.json(rows);
});

/** Crear/editar productos (admin) */
router.post('/', async (req, res) => {
  const { nombre, precio, sector, permite_acomps, max_acomps } = req.body || {};
  const sect = await pool.query(`SELECT id FROM sectores WHERE nombre=$1`, [sector]);
  const sector_id = sect.rows[0]?.id || null;
  const ins = await pool.query(
    `INSERT INTO productos (nombre, precio, sector_id, permite_acomps, max_acomps)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [nombre, precio || 0, sector_id, !!permite_acomps, max_acomps ?? null]
  );
  res.json(ins.rows[0]);
});

/** Acompañamientos por producto (admin) */
router.post('/:id/acomps', async (req, res) => {
  const { id } = req.params;
  const { acomp_ids } = req.body || { acomp_ids: [] };
  await pool.query('BEGIN');
  await pool.query(`DELETE FROM producto_acomps WHERE producto_id=$1`, [id]);
  for (const aid of acomp_ids) {
    await pool.query(`INSERT INTO producto_acomps (producto_id, acomp_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, aid]);
  }
  await pool.query('COMMIT');
  res.json({ ok: true });
});

/** Obtener acompañamientos disponibles para un producto */
router.get('/:id/acomps', async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT pa.acomp_id AS id, p.nombre, p.precio, s.nombre AS sector
     FROM producto_acomps pa
     JOIN productos p ON p.id = pa.acomp_id
     LEFT JOIN sectores s ON s.id = p.sector_id
     WHERE pa.producto_id = $1
     ORDER BY p.nombre`, [id]
  );
  res.json(rows);
});

module.exports = router;
