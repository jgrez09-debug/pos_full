// server/routes/admin.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

router.post('/usuarios', async (req, res) => {
  const { usuario, contrasena, rol } = req.body;
  try {
    await pool.query(
      'INSERT INTO usuarios (usuario, contrasena, rol) VALUES ($1, $2, $3)',
      [usuario, contrasena, rol]
    );
    res.json({ mensaje: 'Usuario creado' });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

module.exports = router;
