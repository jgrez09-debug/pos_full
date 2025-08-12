const express = require('express');
const router = express.Router();
const pool = require('../db');

// Abrir turno
router.post('/open', async (req, res) => {
  const { usuario_id = 1, nombre = 'Turno' } = req.body || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO turnos (usuario_id, nombre) VALUES ($1,$2) RETURNING id, nombre, fecha_apertura`,
      [usuario_id, nombre]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ mensaje: 'Error abriendo turno' });
  }
});

// Turnos abiertos
router.get('/open', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, usuario_id, nombre, fecha_apertura FROM turnos WHERE fecha_cierre IS NULL ORDER BY id DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ mensaje: 'Error' });
  }
});

// Cerrar turno
router.post('/close/:id', async (req, res) => {
  const id = req.params.id;
  const {
    total_efectivo = 0,
    total_tarjeta = 0,
    total_transferencia = 0
  } = req.body || {};
  try {
    await pool.query(
      `UPDATE turnos
       SET fecha_cierre=NOW(),
           total_efectivo=$1, total_tarjeta=$2, total_transferencia=$3
       WHERE id=$4`,
      [total_efectivo, total_tarjeta, total_transferencia, id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ mensaje: 'Error cerrando turno' });
  }
});

module.exports = router;
