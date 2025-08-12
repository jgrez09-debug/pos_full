// server/routes/acomps.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM acomp');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send('Error al obtener acompañamientos');
  }
});

module.exports = router;
