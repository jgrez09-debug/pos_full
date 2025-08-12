// server/src/routes/precuentas.js
// Rutas de PRECUENTAS (detalle, items, acompañamientos, impresión) con legibilidad optimizada

import { Router } from 'express';
import { pool } from '../db.js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import puppeteer from 'puppeteer';
import p2p from 'pdf-to-printer';
const { print: printPDF, getPrinters } = p2p;

const router = Router();
const PRINTER = process.env.PRINTER_PRECUENTA || 'XPrinter 80mm';

/* ───────── Helpers ───────── */

const moneyCL = (n) => {
  try { return new Intl.NumberFormat('es-CL').format(Number(n || 0)); }
  catch { return `${n}`; }
};

async function recalcPrecuenta(preId) {
  const { rows: r1 } = await pool.query(
    `SELECT COALESCE(SUM(i.cantidad * i.precio_unitario),0) AS sub_items
       FROM precuenta_items i
      WHERE i.precuenta_id = $1`, [preId]
  );
  const subItems = Number(r1[0].sub_items || 0);

  const { rows: r2 } = await pool.query(
    `SELECT COALESCE(SUM(pia.precio_extra * i.cantidad),0) AS sub_acomps
       FROM precuenta_item_acompanamientos pia
       JOIN precuenta_items i ON i.id = pia.precuenta_item_id
      WHERE i.precuenta_id = $1`, [preId]
  );
  const subAcomps = Number(r2[0].sub_acomps || 0);

  const subtotal = subItems + subAcomps;

  const { rows: r3 } = await pool.query(
    `SELECT COALESCE(propina_porcentaje,10) AS p
       FROM precuentas WHERE id=$1 LIMIT 1`, [preId]
  );
  const p = Number(r3[0]?.p ?? 10);
  const propina = Math.round((subtotal * p) / 100);

  await pool.query(
    `UPDATE precuentas
        SET total_sin_propina=$2, propina_porcentaje=$3, propina_monto=$4
      WHERE id=$1`, [preId, subtotal, p, propina]
  );
  return { subtotal, p, propina, total: subtotal + propina };
}

/** HTML optimizado: títulos grandes; productos/extras al tamaño anterior */
async function htmlPrecuenta(preId) {
  const { rows: Hrows } = await pool.query(
    `SELECT p.id, p.numero, p.mesa_id, p.mesero_id, p.estado,
            p.total_sin_propina, p.propina_porcentaje, p.propina_monto,
            (COALESCE(p.total_sin_propina,0)+COALESCE(p.propina_monto,0)) AS total_con_propina,
            m.numero AS mesa_numero,
            u.nombre_completo AS mesero_nombre,
            to_char(p.creado_en AT TIME ZONE 'America/Santiago','DD-MM-YYYY HH24:MI') AS fecha
       FROM precuentas p
       JOIN mesas m ON m.id = p.mesa_id
       LEFT JOIN usuarios u ON u.id = p.mesero_id
      WHERE p.id=$1 LIMIT 1`, [preId]
  );
  if (!Hrows.length) throw new Error('Precuenta no encontrada');
  const H = Hrows[0];

  const { rows: drows } = await pool.query(
    `SELECT i.id AS item_id, i.producto_id, i.cantidad, i.precio_unitario,
            pr.nombre AS producto_nombre,
            COALESCE(
              json_agg(json_build_object('id', a.id, 'nombre', a.nombre, 'precio_extra', pia.precio_extra))
              FILTER (WHERE pia.precuenta_item_id IS NOT NULL),
              '[]'
            ) AS acomp
       FROM precuenta_items i
       JOIN productos pr ON pr.id = i.producto_id
       LEFT JOIN precuenta_item_acompanamientos pia ON pia.precuenta_item_id = i.id
       LEFT JOIN acompanamientos a ON a.id = pia.acompanamiento_id
      WHERE i.precuenta_id = $1
      GROUP BY i.id, pr.id
      ORDER BY pr.nombre`, [preId]
  );

  const lineas = drows.map(li => {
    const acomp = Array.isArray(li.acomp) ? li.acomp : JSON.parse(li.acomp || '[]');
    const acompHTML = acomp.map(a => `
      <div class="row sub">
        <div class="name">${li.cantidad} x ${a.nombre}</div>
        <div class="price">$${moneyCL(Number(a.precio_extra) * Number(li.cantidad||1))}</div>
      </div>
    `).join('');
    return `
      <div class="row item">
        <div class="name"><strong class="up">${li.cantidad} x ${li.producto_nombre}</strong></div>
        <div class="price big">$${moneyCL(Number(li.precio_unitario) * Number(li.cantidad||1))}</div>
      </div>
      ${acompHTML}
    `;
  }).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Precuenta #${String(H.numero||'').padStart(3,'0')}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  body {
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    font-family: Arial, 'Helvetica Neue', Roboto, sans-serif;
    font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1, "lnum" 1;
    color:#000;
    width: 74mm; margin: 0; padding: 4mm;
    font-size: 15px;        /* base (títulos y totales se ven grandes) */
    line-height: 1.35;
  }
  .h { text-align:center; margin: 0 0 6px 0; }
  .t { font-size: 18px; font-weight: 800; letter-spacing: .2px; }
  .small { font-size: 12.8px; }
  .row { display:flex; justify-content:space-between; align-items:baseline; margin: 3px 0; }
  .item { font-size: 13.5px; }       /* ← productos al tamaño anterior */
  .sub  { padding-left: 8px; font-size: 12.5px; }  /* ← extras al tamaño anterior */
  .name { max-width: 50mm; word-wrap: break-word; }
  .price { width: 24mm; text-align: right; }
  .price.big { font-weight: 700; }
  .hr { border-top: 2px dashed #000; margin: 6px 0; }
  .tot { font-size: 17px; font-weight: 800; }
  .up { text-transform: uppercase; }
</style>
</head>
<body>
  <div class="h">
    <div class="t">PRECUENTA</div>
    <div class="small">Mesa ${H.mesa_numero} · Pre #${String(H.numero||'').padStart(3,'0')}</div>
    <div class="small">${H.fecha} · ${H.mesero_nombre || ''}</div>
  </div>

  <div class="hr"></div>
  ${lineas || '<div class="item">— Sin productos —</div>'}
  <div class="hr"></div>

  <div class="row"><div>Subtotal</div><div>$${moneyCL(H.total_sin_propina)}</div></div>
  <div class="row"><div>Propina ${H.propina_porcentaje || 10}%</div><div>$${moneyCL(H.propina_monto)}</div></div>
  <div class="row tot"><div>Total</div><div>$${moneyCL(H.total_con_propina)}</div></div>

  <div class="hr"></div>
  <div class="small">* Documento no tributario.</div>
  <script>window.onload=()=>{try{window.print()}catch(_){}}</script>
</body>
</html>`;
}

/* ── Candado anti-doble impresión ── */
const PRINT_LOCK_MS = Number(process.env.PRINT_LOCK_TIMEOUT_MS || 6000);
const printLocks = new Map();
const lockNow = (id) => printLocks.set(id, Date.now() + PRINT_LOCK_MS);
const isLocked = (id) => (printLocks.get(id) || 0) > Date.now();
const unlock  = (id) => printLocks.delete(id);

/* ───────── Rutas ───────── */

// Debug impresoras
router.get('/__impresoras', async (_req, res) => {
  try { const printers = await getPrinters(); res.json(printers.map(p => p.name)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Header + detalle
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: H } = await pool.query(
      `SELECT id, numero, estado,
              total_sin_propina, propina_porcentaje, propina_monto,
              (COALESCE(total_sin_propina,0)+COALESCE(propina_monto,0)) AS total_con_propina
         FROM precuentas WHERE id=$1 LIMIT 1`, [id]
    );
    if (!H.length) return res.status(404).json({ error: 'Precuenta no encontrada' });
    const header = H[0];

    const { rows } = await pool.query(
      `SELECT i.id AS item_id, i.producto_id, i.cantidad, i.precio_unitario,
              pr.nombre AS nombre_producto,
              COALESCE(
                json_agg(json_build_object('id', a.id, 'nombre', a.nombre, 'precio_extra', pia.precio_extra))
                FILTER (WHERE pia.precuenta_item_id IS NOT NULL),
                '[]'
              ) AS acomps
         FROM precuenta_items i
         JOIN productos pr ON pr.id = i.producto_id
         LEFT JOIN precuenta_item_acompanamientos pia ON pia.precuenta_item_id = i.id
         LEFT JOIN acompanamientos a ON a.id = pia.acompanamiento_id
        WHERE i.precuenta_id = $1
        GROUP BY i.id, pr.id
        ORDER BY pr.nombre`, [id]
    );

    const detalle = rows.map(r => ({
      item_id: r.item_id,
      producto_id: r.producto_id,
      nombre_producto: r.nombre_producto,
      cantidad: Number(r.cantidad || 1),
      precio_unitario: Number(r.precio_unitario || 0),
      acomps: Array.isArray(r.acomps) ? r.acomps : JSON.parse(r.acomps || '[]'),
    }));
    res.json({ header, detalle });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener la precuenta' });
  }
});

// Agregar item
router.post('/:id/items', async (req, res) => {
  const { id } = req.params;
  const { producto_id } = req.body || {};
  if (!producto_id) return res.status(400).json({ error: 'producto_id requerido' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO precuenta_items (precuenta_id, producto_id, cantidad, precio_unitario)
       VALUES ($1,$2,1,(SELECT precio FROM productos WHERE id=$2))
       RETURNING id`, [id, producto_id]
    );
    await recalcPrecuenta(id);
    res.json({ item_id: rows[0].id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo agregar el item' });
  }
});

// Inc / Dec
router.patch('/:preId/items/:itemId', async (req, res) => {
  const { preId, itemId } = req.params;
  const { op } = req.body || {};
  if (!['inc','dec'].includes(op)) return res.status(400).json({ error: 'op inválida' });

  try {
    if (op === 'inc') {
      await pool.query(`UPDATE precuenta_items SET cantidad=cantidad+1 WHERE id=$1`, [itemId]);
    } else {
      const { rows } = await pool.query(`SELECT cantidad FROM precuenta_items WHERE id=$1`, [itemId]);
      const q = Number(rows[0]?.cantidad || 1);
      if (q <= 1) {
        await pool.query(`DELETE FROM precuenta_item_acompanamientos WHERE precuenta_item_id=$1`, [itemId]).catch(()=>{});
        await pool.query(`DELETE FROM precuenta_items WHERE id=$1`, [itemId]);
      } else {
        await pool.query(`UPDATE precuenta_items SET cantidad=cantidad-1 WHERE id=$1`, [itemId]);
        await pool.query(
          `UPDATE precuenta_item_acompanamientos
              SET subtotal_extra = precio_extra * (SELECT cantidad FROM precuenta_items WHERE id=$1)
            WHERE precuenta_item_id=$1`, [itemId]
        ).catch(()=>{});
      }
    }
    await recalcPrecuenta(preId);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo actualizar el item' });
  }
});

// Eliminar item
router.delete('/:preId/items/:itemId', async (req, res) => {
  const { preId, itemId } = req.params;
  try {
    await pool.query(`DELETE FROM precuenta_item_acompanamientos WHERE precuenta_item_id=$1`, [itemId]).catch(()=>{});
    await pool.query(`DELETE FROM precuenta_items WHERE id=$1`, [itemId]);
    await recalcPrecuenta(preId);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar el item' });
  }
});

// Agregar acompañamiento (upsert)
router.post('/:preId/items/:itemId/acompanamientos', async (req, res) => {
  const { preId, itemId } = req.params;
  const { acompanamiento_id } = req.body || {};
  if (!acompanamiento_id) return res.status(400).json({ error: 'acompanamiento_id requerido' });

  try {
    const upd = await pool.query(
      `UPDATE precuenta_item_acompanamientos
          SET precio_extra = (SELECT precio_extra FROM acompanamientos WHERE id=$2),
              subtotal_extra = (SELECT precio_extra FROM acompanamientos WHERE id=$2) * (SELECT cantidad FROM precuenta_items WHERE id=$1)
        WHERE precuenta_item_id=$1 AND acompanamiento_id=$2`,
      [itemId, acompanamiento_id]
    );
    if (upd.rowCount === 0) {
      await pool.query(
        `INSERT INTO precuenta_item_acompanamientos (precuenta_item_id, acompanamiento_id, precio_extra, subtotal_extra)
         VALUES (
           $1, $2,
           (SELECT precio_extra FROM acompanamientos WHERE id=$2),
           (SELECT precio_extra FROM acompanamientos WHERE id=$2) * (SELECT cantidad FROM precuenta_items WHERE id=$1)
         )`,
        [itemId, acompanamiento_id]
      );
    }
    await recalcPrecuenta(preId);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo agregar el acompañamiento' });
  }
});

// Propina
router.post('/:id/propina', async (req, res) => {
  const { id } = req.params;
  const { porcentaje } = req.body || {};
  const p = Number(porcentaje);
  if (Number.isNaN(p) || p < 0 || p > 100) return res.status(400).json({ error: 'porcentaje inválido' });

  try {
    await pool.query(`UPDATE precuentas SET propina_porcentaje=$2 WHERE id=$1`, [id, p]);
    const tot = await recalcPrecuenta(id);
    res.json({ ok:true, ...tot });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo actualizar la propina' });
  }
});

// Anular
router.post('/:id/anular', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE mesas SET estado='libre', mesero_id=NULL
        WHERE id=(SELECT mesa_id FROM precuentas WHERE id=$1)`, [id]
    );
    await pool.query(`UPDATE precuentas SET estado='anulada' WHERE id=$1`, [id]);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo anular la precuenta' });
  }
});

// Imprimir (directo) con escala ↑ para mejor definición
router.post('/:id/imprimir-precuenta', async (req, res) => {
  const { id } = req.params;
  const direct = !!req.body?.direct;

  if (isLocked(id)) {
    return res.status(202).json({ ok:true, dedup:true, message:'Ya se está imprimiendo' });
  }
  lockNow(id);

  try {
    await recalcPrecuenta(id);
    const html = await htmlPrecuenta(id);

    if (!direct) {
      unlock(id);
      return res.json({ html });
    }

    const tmp = path.join(os.tmpdir(), `precuenta-${id}-${Date.now()}.pdf`);
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();

    // Mayor densidad y media print
    await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 2 });
    await page.emulateMediaType('print');

    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: tmp,
      width: '80mm',
      printBackground: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
      scale: 1.25
    });
    await browser.close();

    await printPDF(tmp, { printer: PRINTER, copies: 1 });
    await fs.unlink(tmp).catch(() => {});
    res.json({ ok:true, printer: PRINTER });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo imprimir la precuenta' });
  } finally {
    setTimeout(() => unlock(id), 800);
  }
});

export default router;
