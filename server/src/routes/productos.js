// server/src/routes/productos.js  (ESM)
import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

/**
 * GET /api/productos
 * Lista productos activos con su categoría y sector destino
 */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.nombre, p.precio, c.nombre AS categoria, s.nombre AS sector
         FROM productos p
         JOIN categorias c ON c.id = p.categoria_id
         JOIN sectores_impresion s ON s.id = c.sector_id
        WHERE p.activo = TRUE
        ORDER BY c.nombre, p.nombre`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/productos/:id/acompanamientos
 * Acompañamientos permitidos para un producto (con precio extra resuelto)
 */
router.get('/:id/acompanamientos', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.nombre,
              COALESCE(pa.precio_extra_override, a.precio_extra) AS precio_extra
         FROM producto_acompanamiento pa
         JOIN acompanamientos a ON a.id = pa.acompanamiento_id
        WHERE pa.producto_id = $1
        ORDER BY a.nombre`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
