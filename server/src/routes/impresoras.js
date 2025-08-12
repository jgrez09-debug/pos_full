import { Router } from 'express';
import { pool } from '../db.js';
const router = Router();

/** CRUD impresoras */
router.get('/', async (_req,res)=> {
  const { rows } = await pool.query(
    `SELECT id, nombre, driver, direccion, config_json, activo FROM impresoras ORDER BY nombre`
  );
  res.json(rows);
});

router.post('/', async (req,res)=> {
  const { nombre, driver='agent', direccion=null, config_json={} } = req.body || {};
  const { rows } = await pool.query(
    `INSERT INTO impresoras (nombre, driver, direccion, config_json)
     VALUES ($1,$2,$3,$4::jsonb) RETURNING *`,
    [nombre, driver, direccion, JSON.stringify(config_json)]
  );
  res.json(rows[0]);
});

router.patch('/:id', async (req,res)=> {
  const { id } = req.params;
  const { nombre, driver, direccion, config_json, activo } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE impresoras
        SET nombre=COALESCE($2,nombre),
            driver=COALESCE($3,driver),
            direccion=COALESCE($4,direccion),
            config_json=COALESCE($5::jsonb,config_json),
            activo=COALESCE($6,activo)
      WHERE id=$1
      RETURNING *`,
    [id, nombre, driver, direccion, config_json ? JSON.stringify(config_json) : null, activo]
  );
  res.json(rows[0]);
});

router.delete('/:id', async (req,res)=> {
  await pool.query(`DELETE FROM impresoras WHERE id=$1`, [req.params.id]);
  res.json({ok:true});
});

/** Canales y rutas */
router.get('/canales', async (_req,res)=> {
  const { rows } = await pool.query(`SELECT id, codigo, descripcion FROM canales_impresion ORDER BY id`);
  res.json(rows);
});

router.get('/rutas', async (_req,res)=> {
  const { rows } = await pool.query(
    `SELECT r.id, c.codigo AS canal, i.id AS impresora_id, i.nombre AS impresora_nombre
       FROM rutas_impresion r
       JOIN canales_impresion c ON c.id=r.canal_id
       JOIN impresoras i ON i.id=r.impresora_id
      ORDER BY c.codigo`
  );
  res.json(rows);
});

/** Set route (canal -> impresora) */
router.post('/rutas', async (req,res)=> {
  const { canal, impresora_id } = req.body || {};
  // upsert
  const { rows } = await pool.query(
    `
    INSERT INTO rutas_impresion (canal_id, impresora_id)
    SELECT c.id, $2 FROM canales_impresion c WHERE c.codigo=$1
    ON CONFLICT (canal_id) DO UPDATE SET impresora_id=EXCLUDED.impresora_id
    RETURNING (SELECT codigo FROM canales_impresion WHERE id=canal_id) AS canal,
              impresora_id
    `,
    [canal, impresora_id]
  );
  res.json(rows[0]);
});

export default router;
