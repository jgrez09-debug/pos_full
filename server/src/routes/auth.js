import { Router } from 'express';
import { pool } from '../db.js';
import jwt from 'jsonwebtoken';

const router = Router();

/**
 * POST /api/login
 * Body: { usuario, contrasena }  // o { usuario, password }
 * Respuesta: { token, user:{ id, usuario, nombre_completo, rol } }
 */
router.post('/', async (req, res) => {
  try {
    const { usuario, password, contrasena } = req.body || {};
    const pass = contrasena ?? password ?? '';
    if (!usuario || !pass) return res.status(400).json({ error: 'Faltan credenciales' });

    // Usuario + rol (según tu DB: usuarios.id_rol -> roles.id)
    const { rows } = await pool.query(
      `SELECT u.id, u.usuario, u.contrasena, u.nombre_completo, r.nombre AS rol
         FROM usuarios u
         JOIN roles r ON u.id_rol = r.id
        WHERE u.usuario = $1
        LIMIT 1`,
      [usuario]
    );

    const u = rows[0];
    if (!u) return res.status(401).json({ error: 'Usuario o clave inválidos' });

    // Comparación en texto plano (tal como está hoy)
    if (String(u.contrasena ?? '') !== String(pass)) {
      return res.status(401).json({ error: 'Usuario o clave inválidos' });
    }

    const user = {
      id: u.id,
      usuario: u.usuario,
      nombre_completo: u.nombre_completo || u.usuario,
      rol: u.rol, // admin | mesero | cajero
    };

    const token = jwt.sign(user, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES || '7d',
    });

    res.json({ token, user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
