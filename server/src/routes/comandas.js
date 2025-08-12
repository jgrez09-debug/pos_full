import { Router } from 'express';
import { pool } from '../db.js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import puppeteer from 'puppeteer';
import p2p from 'pdf-to-printer';

const { print: printPDF } = p2p;
const router = Router();

/* ========== Helpers ========== */

async function getHeader(preId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.numero, p.mesa_id, p.mesero_id,
            m.numero  AS mesa_numero,
            u.nombre_completo AS mesero_nombre,
            to_char(p.creado_en AT TIME ZONE 'America/Santiago','DD-MM-YYYY HH24:MI') AS fecha
       FROM precuentas p
       JOIN mesas m   ON m.id = p.mesa_id
  LEFT JOIN usuarios u ON u.id = p.mesero_id
      WHERE p.id = $1
      LIMIT 1`,
    [preId]
  );
  if (!rows.length) throw new Error('Precuenta no encontrada');
  return rows[0];
}

/**
 * Para COMANDA:
 * 1) Obtenemos ítems a nivel de item (para conocer sus acompañamientos reales).
 * 2) Dentro de cada sector, agrupamos por firma (producto_id + set de acompañamientos ordenado).
 *    Así, dos ítems idénticos se suman en una sola línea con su cantidad.
 *
 * En TU esquema el sector viene por: productos.categoria_id -> categorias.sector_id -> sectores_impresion.nombre
 */
async function getDetalleAgrupadoPorSector(preId) {
  const { rows } = await pool.query(
    `SELECT i.id AS item_id,
            i.cantidad,
            pr.id     AS producto_id,
            pr.nombre AS producto_nombre,
            s.nombre  AS sector_nombre,
            COALESCE(
              json_agg(json_build_object('id', a.id, 'nombre', a.nombre))
              FILTER (WHERE pia.precuenta_item_id IS NOT NULL),
              '[]'
            ) AS acomp
       FROM precuenta_items i
       JOIN productos pr                ON pr.id = i.producto_id
  LEFT JOIN categorias c               ON c.id = pr.categoria_id
  LEFT JOIN sectores_impresion s       ON s.id = c.sector_id
  LEFT JOIN precuenta_item_acompanamientos pia ON pia.precuenta_item_id = i.id
  LEFT JOIN acompanamientos a          ON a.id = pia.acompanamiento_id
      WHERE i.precuenta_id = $1
      GROUP BY i.id, i.cantidad, pr.id, pr.nombre, s.nombre
      ORDER BY s.nombre NULLS LAST, i.id`,
    [preId]
  );

  // canal -> items[] (ya AGRUPADOS)
  const byCanal = new Map();

  const normIds = (arr) =>
    Array.from(new Set((arr || []).map(a => Number(a.id)).filter(Number.isFinite))).sort((a,b)=>a-b);

  for (const r of rows) {
    const canal = r.sector_nombre || 'General';
    if (!byCanal.has(canal)) byCanal.set(canal, new Map()); // firma -> item agrupado

    const pid = Number(r.producto_id);
    const acompIds = normIds(Array.isArray(r.acomp) ? r.acomp : JSON.parse(r.acomp || '[]'));
    const firma = JSON.stringify({ pid, a: acompIds });

    if (!byCanal.get(canal).has(firma)) {
      byCanal.get(canal).set(firma, {
        firma,
        producto_id: pid,
        nombre: r.producto_nombre,
        cantidad: 0,
        acomp: (Array.isArray(r.acomp) ? r.acomp : JSON.parse(r.acomp || '[]')).map(a => ({
          id: Number(a.id),
          nombre: a.nombre
        })),
      });
    }
    const g = byCanal.get(canal).get(firma);
    g.cantidad += Number(r.cantidad || 1);
  }

  // Convertir a: canal -> items[]
  const result = new Map();
  for (const [canal, mapFirmas] of byCanal.entries()) {
    const items = Array.from(mapFirmas.values())
      .sort((a,b) => a.nombre.localeCompare(b.nombre,'es'));
    result.set(canal, items);
  }
  return result;
}

/** rutas_impresion.canal -> impresoras.nombre -> impresoras.direccion (cola de Windows) */
async function getPrinterQueueForCanal(canal) {
  const q = await pool.query(
    `SELECT i.direccion AS printer_queue
       FROM rutas_impresion r
       JOIN impresoras i ON i.nombre = r.impresora_nombre
      WHERE r.canal = $1 AND i.activo = TRUE
      LIMIT 1`,
    [canal]
  );
  if (q.rows.length) return q.rows[0].printer_queue;
  return process.env.PRINTER_COMANDA_DEFAULT || process.env.PRINTER_PRECUENTA || '';
}

function htmlComanda({ header, canal, items }) {
  const lines = items.map(li => {
    const acomp = (li.acomp || []).map(a =>
      `<div class="row sub"><div class="name">${li.cantidad} x ${a.nombre}</div></div>`
    ).join('');
    return `
      <div class="row item">
        <div class="name"><strong class="up">${li.cantidad} x ${li.nombre}</strong></div>
      </div>${acomp}`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<title>COMANDA ${canal||''} - Mesa ${header.mesa_numero}</title>
<style>
@page { size: 80mm auto; margin: 0; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact;
  font-family: Arial, 'Helvetica Neue', Roboto, sans-serif; font-variant-numeric: tabular-nums;
  width: 74mm; margin:0; padding:4mm; line-height:1.35; font-size:16px; color:#000; }
.h{ text-align:center; margin:0 0 6px 0; }
.t{ font-size:20px; font-weight:900; letter-spacing:.2px; }
.small{ font-size:13px; }
.row{ display:flex; justify-content:space-between; margin:4px 0; }
.item{ font-size:16px; }
.sub{ padding-left:10px; font-size:14px; }
.name{ max-width:60mm; word-wrap:break-word; }
.hr{ border-top:2px dashed #000; margin:6px 0; }
.up{ text-transform:uppercase; }
</style></head><body>
<div class="h">
  <div class="t">COMANDA ${canal?('· '+canal.toUpperCase()):''}</div>
  <div class="small">Mesa ${header.mesa_numero} · Pre #${String(header.numero||'').padStart(3,'0')}</div>
  <div class="small">${header.fecha} · ${header.mesero_nombre || ''}</div>
</div>
<div class="hr"></div>
${lines || '<div class="item">— Sin productos —</div>'}
<div class="hr"></div>
<div class="small">* Preparación inmediata.</div>
<script>window.onload=()=>{try{window.print()}catch(_){}}</script>
</body></html>`;
}

async function imprimirPDFen(printerQueue, html) {
  if (!printerQueue) throw new Error('Impresora no configurada');
  const tmp = path.join(os.tmpdir(), `comanda-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 2 });
  await page.emulateMediaType('print');
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: tmp, width: '80mm', printBackground: true,
    margin: { top:'0mm', right:'0mm', bottom:'0mm', left:'0mm' },
    scale: 1.15
  });
  await browser.close();
  await printPDF(tmp, { printer: printerQueue, copies: 1 });
  await fs.unlink(tmp).catch(() => {});
}

/* ========== Rutas (¡orden importa!) ========== */

/** Alias por body: /api/comandas/emitir { precuenta_id } */
router.post('/emitir', async (req, res) => {
  const pid = req.body?.precuenta_id;
  if (!pid) return res.status(400).json({ error: 'precuenta_id requerido' });
  req.params.preId = pid;
  req.url = `/${pid}/imprimir`;
  router.handle(req, res);
});

/** Principal: /api/comandas/:preId/imprimir */
router.post('/:preId/imprimir', async (req, res) => {
  const { preId } = req.params;
  try {
    const header = await getHeader(preId);
    const byCanal = await getDetalleAgrupadoPorSector(preId);
    if (byCanal.size === 0) {
      return res.status(400).json({ error: 'No hay productos para comandar' });
    }

    let count = 0;
    const errors = [];

    for (const [canal, items] of byCanal.entries()) {
      const printerQueue = await getPrinterQueueForCanal(canal);
      if (!printerQueue) {
        errors.push(`Sin impresora asignada para canal "${canal}". Configura rutas_impresion(canal -> impresora_nombre).`);
        continue;
      }
      const html = htmlComanda({ header, canal, items });
      try {
        await imprimirPDFen(printerQueue, html);
        count++;
      } catch (err) {
        console.error('ERROR al imprimir', { canal, printerQueue }, err);
        errors.push(`Error imprimiendo canal "${canal}" en cola "${printerQueue}": ${err.message}`);
      }
    }

    if (errors.length) {
      return res.status(count ? 207 : 500).json({ ok: count > 0, sectores_impresos: count, errors });
    }
    return res.json({ ok: true, sectores_impresos: count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron imprimir las comandas' });
  }
});

/** Alias simple: /api/comandas/:preId */
router.post('/:preId', async (req, res) => {
  req.url = `/${req.params.preId}/imprimir`;
  router.handle(req, res);
});

export default router;
