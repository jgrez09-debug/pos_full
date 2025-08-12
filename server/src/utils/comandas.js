// server/src/utils/comandas.js
import { pool } from '../db.js';

// Genera comandas por sector (BARRA/COCINA1/COCINA2) para una precuenta
export async function generarComandas(precuentaId, client = pool) {
  // Traer líneas de la precuenta con acompañamientos
  const { rows: lineas } = await client.query(
    `SELECT
       pi.id as item_id,
       pi.cantidad,
       p.nombre as producto,
       c.sector_id as sector_producto,
       (SELECT json_agg(json_build_object(
          'pia_id', pia.id,
          'acompanamiento', a.nombre,
          'precio_extra', pia.precio_extra
        ) ORDER BY pia.id)
        FROM precuenta_item_acompanamientos pia
        JOIN acompanamientos a ON a.id = pia.acompanamiento_id
        WHERE pia.precuenta_item_id = pi.id
       ) as acomp
     FROM precuenta_items pi
     JOIN productos p   ON p.id = pi.producto_id
     JOIN categorias c  ON c.id = p.categoria_id
     WHERE pi.precuenta_id = $1
     ORDER BY pi.id`,
    [precuentaId]
  );

  // Sectores de impresión
  const { rows: sectores } = await client.query(
    `SELECT id, nombre FROM sectores_impresion`
  );

  let count = 0;
  for (const s of sectores) {
    const cuerpo = [];
    for (const li of lineas) {
      const vaAlSector = li.sector_producto === s.id;
      const acompDeSector = (li.acomp || []); // si luego separas por sector del acompañamiento, filtra aquí
      if (vaAlSector || (acompDeSector?.length)) {
        cuerpo.push({
          item_id: li.item_id,
          producto: vaAlSector ? li.producto : null,
          cantidad: vaAlSector ? li.cantidad : null,
          acomp: acompDeSector
        });
      }
    }
    if (cuerpo.length) {
      await client.query(
        `INSERT INTO comandas (precuenta_id, sector_id, impresora_nombre, cuerpo)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [precuentaId, s.id, s.nombre, JSON.stringify(cuerpo)] // <—
      );
      count++;
    }
  }
  return count;
}
