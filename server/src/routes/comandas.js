// server/src/routes/comandas.js
// Emisión de COMANDAS por canal (sectores) con AGRUPACIÓN y NOTAS
// Usa: productos.categoria_id -> categorias.sector_id -> sectores_impresion.nombre (canal)
// Mapea a impresora con: rutas_impresion.canal -> impresoras.nombre -> impresoras.direccion

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
            to_char(now() AT TIME ZONE 'America/Santiago','DD-MM-YYYY HH24:MI') AS fecha
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
 * Obtiene ítems a nivel de item (para conocer acompañamientos y NOTA reales).
 * Luego agrupa dentro de cada canal por firma: (producto_id + set de acomp ordenado + nota normalizada)
 */
async function getDetalleAgrupadoPorCanal(preId) {
  const { rows } = await pool.query(
    `SELECT i.id AS item_id,
            i.cantidad,
            COALESCE(i.nota,'') AS nota,
            pr.id     AS producto_id,
            pr.nombre AS producto_nombre,
            s.nombre  AS canal,
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
      GROUP BY i.id, i.cantidad, i.nota, pr.id, pr.nombre, s.nombre
      ORDER BY s.nombre NULLS LAST, i.id`,
    [preId]
  );

  // canal -> Map<firma, group>
  const byCanal = new Map();

  const normIds = (arr) =>
    Array.from(new Set((arr || []).map(a => Number(a.id)).filter(Number.isFinite))).sort((a,b)=>a-b);

  for (const r of rows) {
    const canal = (r.canal || 'General').toUpperCase();
    if (!byCanal.has(canal)) byCanal.set(canal, new Map());

    const pid = Number(r.producto_id);
    const acompIds = normIds(Array.isArray(r.acomp) ? r.acomp : JSON.parse(r.acomp || '[]'));
    const notaNorm = String(r.nota || '').trim().toLowerCase();

    const firma = JSON.stringify({ pid, a: acompIds, n: notaNorm });

    if (!byCanal.get(canal).has(firma)) {
      byCanal.get(canal).set(firma, {
        firma,
        producto_id: pid,
        nombre: r.producto_nombre,
        nota: r.nota || '',
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
      .sort((a,b) => {
        const n = a.nombre.localeCompare(b.nombre,'es');
        return n !== 0 ? n : (a.nota || '').localeCompare(b.nota || '', 'es');
      });
    result.set(canal, items);
  }
  return result;
}

/** rutas_impresion.canal -> impresoras.nombre -> impresoras.direccion (cola del SO) */
async function getPrinterQueueForCanal(canal) {
  const q = await pool.query(
    `SELECT i.direccion AS printer_queue
       FROM rutas_impresion r
       JOIN impresoras i ON i.nombre = r.impresora_nombre
      WHERE UPPER(r.canal) = UPPER($1) AND i.activo = TRUE
      LIMIT 1`,
    [canal]
  );
  if (q.rows.length) return q.rows[0].printer_queue;
  // fallback por si quieres un default
  return process.env.PRINTER_COMANDA_DEFAULT || process.env.PRINTER_PRECUENTA || '';
}

function htmlComanda({ header, canal, items }) {
  const lines = items.map(li => {
    const notaHTML = li.nota ? `<div class="nota">★ ${li.nota}</div>` : '';
    const acomp = (li.acomp || []).map(a =>
      `<div class="row sub"><div class="name">${li.cantidad} x ${a.nombre}</div></div>`
    ).join('');
    return `
      <div class="row item">
        <div class="name"><strong class="up">${li.cantidad} x ${li.nombre}</strong></div>
      </div>
      ${notaHTML}
      ${acomp}
      <div class="hr"></div>`;
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
.hr{ border-top:2px dotted #000; margin:6px 0; }
.up{ text-transform:uppercase; }
.nota{ padding-left:2px; font-size:13px; font-style:italic; }
</style></head><body>
<div class="h">
  <div class="t">COMANDA ${canal?('· '+canal.toUpperCase()):''}</div>
  <div class="small">Mesa ${header.mesa_numero} · Pre #${String(header.numero||'').padStart(3,'0')}</div>
  <div class="small">${header.fecha} · ${header.mesero_nombre || ''}</div>
</div>
<div class="hr"></div>
${lines || '<div class="item">— Sin productos —</div>'}
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

/* ====== Candado anti doble emisión ====== */
const LOCK_MS = Number(process.env.COMANDAS_LOCK_MS || 6000);
const locks = new Map();
const isLocked  = (id) => (locks.get(id) || 0) > Date.now();
const lockNow   = (id) => locks.set(id, Date.now() + LOCK_MS);
const unlock    = (id) => locks.delete(id);

/* ========== Rutas (¡orden importa!) ========== */

/** Alias por body: /api/comandas/emitir { precuenta_id } */
router.post('/emitir', async (req, res) => {
  const pid = req.body?.precuenta_id;
  if (!pid) return res.status(400).json({ error: 'precuenta_id requerido' });

  if (isLocked(pid)) {
    return res.status(202).json({ ok: true, dedup: true, message: 'Ya se están emitiendo comandas.' });
  }
  lockNow(pid);

  // Reusa la ruta principal para no duplicar lógica
  req.params.preId = pid;
  req.url = `/${pid}/imprimir`;
  router.handle(req, res);
});

/** Principal: /api/comandas/:preId/imprimir */
router.post('/:preId/imprimir', async (req, res) => {
  const { preId } = req.params;

  try {
    const header = await getHeader(preId);
    const byCanal = await getDetalleAgrupadoPorCanal(preId);

    if (byCanal.size === 0) {
      unlock(preId);
      return res.status(400).json({ error: 'No hay productos para comandar' });
    }

    let count = 0;
    const errors = [];

    for (const [canal, items] of byCanal.entries()) {
      if (!items.length) continue;

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
      unlock(preId);
      return res.status(count ? 207 : 500).json({ ok: count > 0, sectores_impresos: count, errors });
    }
    unlock(preId);
    return res.json({ ok: true, sectores_impresos: count });
  } catch (e) {
    console.error(e);
    unlock(preId);
    res.status(500).json({ error: 'No se pudieron imprimir las comandas' });
  }
});

/** Alias simple: /api/comandas/:preId */
router.post('/:preId', async (req, res) => {
  req.url = `/${req.params.preId}/imprimir`;
  router.handle(req, res);
});

export default router;
