const express = require('express');
const router = express.Router();
const pool = require('../db');

// Ventas por forma de pago
router.get('/ventas', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT tipo, SUM(monto) AS total
      FROM pagos
      GROUP BY tipo
      ORDER BY tipo
    `);
    res.json(rows.map(r => ({ tipo: r.tipo, total: Number(r.total) })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ mensaje: 'Error' });
  }
});

// Propinas por mesero y forma de pago
router.get('/propinas', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.usuario AS mesero, pg.tipo, COALESCE(SUM(pg.propina),0) AS propinas
      FROM pagos pg
      JOIN precuentas p ON p.id=pg.precuenta_id
      JOIN usuarios u ON u.id=p.mesero_id
      GROUP BY u.usuario, pg.tipo
      ORDER BY u.usuario, pg.tipo
    `);
    res.json(rows.map(r => ({ mesero: r.mesero, tipo: r.tipo, propinas: Number(r.propinas) })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ mensaje: 'Error' });
  }
});

// Top productos (solo principales, sin acompañamientos)
router.get('/top-products', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT pr.nombre, COALESCE(SUM(i.cantidad),0) AS unidades
      FROM precuenta_items i
      JOIN productos pr ON pr.id=i.producto_id
      WHERE i.es_acomp=false
      GROUP BY pr.nombre
      ORDER BY unidades DESC
      LIMIT 20
    `);
    res.json(rows.map(r => ({ nombre: r.nombre, unidades: Number(r.unidades) })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ mensaje: 'Error' });
  }
});

module.exports = router;
