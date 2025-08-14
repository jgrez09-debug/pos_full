// server/src/routes/comandas.js
// Emisión de COMANDAS por sector (Cocina/Barra) con agrupación, notas
// y guardado robusto en KDS (mesa_numero nunca va null).

import { Router } from 'express';
import { pool } from '../db.js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import puppeteer from 'puppeteer';
import p2p from 'pdf-to-printer';
const { print: printPDF } = p2p;

const router = Router();

/* ===================== Helpers ===================== */

// Candado anti doble emisión por precuenta
const LOCK_MS = Number(process.env.COMANDAS_LOCK_MS || 6000);
const locks = new Map();
const isLocked  = (id) => (locks.get(id) || 0) > Date.now();
const lockNow   = (id) => locks.set(id, Date.now() + LOCK_MS);
const unlock    = (id) => locks.delete(id);

// >>> Whitelist de sectores que SÍ se guardan en KDS (impresión no se toca)
const KDS_SECTORES_INCLUDE = (process.env.KDS_SECTORES_INCLUDE || 'COCINA1,COCINA2')
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);
const KDS_INCLUDE_SET = new Set(KDS_SECTORES_INCLUDE);

// Normalizadores seguros
const str = (v) => (v == null ? '' : String(v));
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
function normAcomps(v) {
  try {
    const arr = Array.isArray(v) ? v : JSON.parse(v || '[]');
    return (arr || [])
      .filter(a => a && (a.nombre || a.id != null))
      .map(a => ({
        id: num(a.id, 0),
        nombre: str(a.nombre || a),
        // precio_extra no se utiliza en KDS, pero lo dejamos si viene
        precio_extra: num(a.precio_extra, 0),
      }));
  } catch {
    return [];
  }
}

// Info de cabecera para el ticket (incluye mesa_numero)
async function getHeader(preId) {
  const { rows } = await pool.query(
    `SELECT p.id,
            p.numero              AS pre_numero,
            m.numero              AS mesa_numero,
            u.nombre_completo     AS mesero_nombre,
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

// Si por alguna razón el header no trae la mesa, la resolvemos aquí
async function ensureMesaNumero(preId, header) {
  if (header && header.mesa_numero != null) return num(header.mesa_numero, null);
  const { rows } = await pool.query(
    `SELECT m.numero AS mesa_numero
       FROM precuentas p
       JOIN mesas m ON m.id = p.mesa_id
      WHERE p.id = $1
      LIMIT 1`,
    [preId]
  );
  if (!rows.length || rows[0].mesa_numero == null) {
    throw new Error('No se pudo resolver mesa_numero para KDS');
  }
  return num(rows[0].mesa_numero, null);
}

/**
 * Detalle CRUDO por ÍTEM con SECTOR correcto (desde categorias.sector_id)
 * (No agrupa; se usa crudo para KDS)
 */
async function getDetalleCrudoPorSector(preId) {
  const { rows } = await pool.query(
    `
    SELECT
      i.id                 AS item_id,
      i.precuenta_id       AS precuenta_id,
      i.cantidad,
      COALESCE(i.nota,'')  AS nota,
      pr.id                AS producto_id,
      pr.nombre            AS producto_nombre,
      COALESCE(
        json_agg(
          json_build_object('id', a.id, 'nombre', a.nombre, 'precio_extra', pia.precio_extra)
        ) FILTER (WHERE pia.precuenta_item_id IS NOT NULL),
        '[]'
      )                   AS acomps,
      c.sector_id          AS sector_id,
      s.nombre             AS sector_nombre
    FROM precuenta_items i
    JOIN productos pr                      ON pr.id = i.producto_id
    LEFT JOIN categorias c                 ON c.id  = pr.categoria_id
    LEFT JOIN sectores_impresion s         ON s.id  = c.sector_id
    LEFT JOIN precuenta_item_acompanamientos pia ON pia.precuenta_item_id = i.id
    LEFT JOIN acompanamientos a            ON a.id  = pia.acompanamiento_id
    WHERE i.precuenta_id = $1
    GROUP BY i.id, pr.id, c.sector_id, s.nombre
    ORDER BY pr.nombre
    `,
    [preId]
  );

  return rows.map(r => ({
    item_id: r.item_id,
    precuenta_id: r.precuenta_id,
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    cantidad: num(r.cantidad, 1),
    nota: str(r.nota || ''),
    acomps: normAcomps(r.acomps),
    sector_id: num(r.sector_id, 0),         // 0/null => sin sector
    sector_nombre: str(r.sector_nombre || ''), // p.ej. 'BARRA', 'COCINA1', 'COCINA2'
  }));
}

/**
 * AGRUPACIÓN para IMPRESIÓN (producto + set acomp + nota), por SECTOR
 */
function buildGroupsBySector(rows) {
  /** Map<sectorNombre, Map<firma, group>> */
  const bySector = new Map();

  for (const li of rows) {
    const sector = (li.sector_nombre || '').trim() || 'SIN_SECTOR';

    // acomp set normalizado y tolerante a huecos
    const acompIds = Array.isArray(li.acomps)
      ? Array.from(new Set(li.acomps.map(a => num(a?.id, NaN)).filter(Number.isFinite))).sort((a,b)=>a-b)
      : [];

    const notaNorm = (li.nota || '').trim().toLowerCase();
    const firma = JSON.stringify({ pid: num(li.producto_id, 0), a: acompIds, n: notaNorm });

    if (!bySector.has(sector)) bySector.set(sector, new Map());
    const m = bySector.get(sector);

    if (!m.has(firma)) {
      m.set(firma, {
        firma,
        producto_id: num(li.producto_id, 0),
        nombre: str(li.producto_nombre),
        nota: str(li.nota || ''),
        acomps: (Array.isArray(li.acomps) ? li.acomps : [])
          .filter(Boolean)
          .map(a => ({
            id: num(a.id, 0),
            nombre: str(a.nombre),
            precio_extra: num(a.precio_extra, 0),
          })),
        cantidad: 0,
      });
    }
    const g = m.get(firma);
    g.cantidad += num(li.cantidad, 1);
  }

  // Map<string, group[]>, ordenado por nombre y nota
  const out = new Map();
  for (const [sector, m] of bySector.entries()) {
    const arr = Array.from(m.values()).sort((a,b) => {
      const n = a.nombre.localeCompare(b.nombre, 'es');
      return n !== 0 ? n : (a.nota || '').localeCompare(b.nota || '', 'es');
    });
    out.set(sector, arr);
  }
  return out;
}

// Resuelve la impresora por nombre de sector
async function getPrinterForSectorName(sectorNombre) {
  if (!sectorNombre) return null;
  const { rows } = await pool.query(
    `SELECT nombre, direccion, activo
       FROM impresoras
      WHERE activo = true AND UPPER(nombre) = UPPER($1)
      LIMIT 1`,
    [sectorNombre]
  );
  if (!rows.length) return null;
  const r = rows[0];
  // Usamos 'direccion' si está seteada; si no, caemos a 'nombre'
  return r.direccion?.trim() ? r.direccion.trim() : r.nombre.trim();
}

// HTML simple de comanda (sin precios, con nota debajo del producto a la izquierda)
function htmlComanda(sector, header, groups) {
  const lineas = groups.map(g => {
    const acompHTML = (g.acomps || []).map(a => `
      <div class="row sub">
        <div class="name">${g.cantidad} x ${a.nombre}</div>
      </div>
    `).join('');
    const notaHTML = g.nota ? `<div class="nota">★ ${g.nota}</div>` : '';
    return `
      <div class="row item">
        <div class="name"><strong class="up">${g.cantidad} x ${g.nombre}</strong></div>
      </div>
      ${notaHTML}
      ${acompHTML}
      <div class="dotted"></div>
    `;
  }).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Comanda ${sector}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  body {
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    font-family: Arial, 'Helvetica Neue', Roboto, sans-serif;
    font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1, "lnum" 1;
    color:#000; width: 74mm; margin: 0; padding: 4mm; font-size: 14px; line-height: 1.35;
  }
  .h { text-align:center; margin: 0 0 6px 0; }
  .t { font-size: 18px; font-weight: 800; letter-spacing: .2px; }
  .small { font-size: 12.5px; }
  .row { display:flex; justify-content:space-between; align-items:baseline; margin: 3px 0; }
  .item { font-size: 14px; }
  .sub  { padding-left: 8px; font-size: 12.5px; }
  .name { max-width: 58mm; word-wrap: break-word; }
  .dotted { border-top: 2px dotted #000; margin: 6px 0; }
  .up { text-transform: uppercase; }
  .nota { padding-left: 2px; font-size: 12.5px; font-style: italic; }
</style>
</head>
<body>
  <div class="h">
    <div class="t">COMANDA · ${sector}</div>
    <div class="small">Mesa ${header.mesa_numero} · Pre #${String(header.pre_numero || '').padStart(3,'0')}</div>
    <div class="small">${header.fecha} · ${header.mesero_nombre || ''}</div>
  </div>
  <div class="dotted"></div>
  ${lineas || '<div class="item">— Sin productos —</div>'}
  <div class="small">· Preparación inmediata.</div>
  <script>window.onload=()=>{try{window.print()}catch(_){}}</script>
</body>
</html>`;
}

// Genera PDF temporal y envía a la impresora indicada
async function printHtmlTo(printerName, html, label = 'comanda') {
  const tmp = path.join(os.tmpdir(), `${label}-${Date.now()}.pdf`);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
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
  await printPDF(tmp, { printer: printerName, copies: 1 });
  await fs.unlink(tmp).catch(() => {});
}

/* ===== Guardado en KDS (robusto con mesa_numero) ========================== */

/**
 * Guarda tickets KDS por SECTOR a partir de filas CRUDAS (1 por ítem)
 * - Ticket: estado 'pendiente', incluye mesero y mesa_numero
 * - Items: unitarizados (cantidad=1 repetida 'veces'), estado 'pendiente'
 * - **Filtra** por KDS_SECTORES_INCLUDE (ej. excluye BARRA si no está en la lista)
 */
async function saveKDS(header, rowsCrudas) {
  // Agrupar filas crudas por sector
  const porSector = new Map();
  for (const r of rowsCrudas) {
    const sectorRaw = (r.sector_nombre || '').trim() || 'SIN_SECTOR';
    if (!porSector.has(sectorRaw)) porSector.set(sectorRaw, []);
    porSector.get(sectorRaw).push(r);
  }

  for (const [sectorRaw, lista] of porSector.entries()) {
    if (!lista.length) continue;

    // Gate para KDS: solo guardar si el sector está permitido
    const sectorKey = sectorRaw.toUpperCase();
    if (!KDS_INCLUDE_SET.has(sectorKey)) {
      // omitimos guardar en KDS para este sector (pero sí se imprimirá más abajo)
      continue;
    }

    const { rows: T } = await pool.query(
      `INSERT INTO kds_tickets (precuenta_id, mesa_numero, sector, estado, mesero_nombre, creado_en, actualizado_en)
       VALUES ($1,$2,$3,'pendiente',$4, now(), now())
       RETURNING id`,
      [ header.id, header.mesa_numero, sectorRaw, header.mesero_nombre || '' ]
    );
    const ticketId = T[0].id;

    const insertItem = `
      INSERT INTO kds_items (ticket_id, cantidad, producto, nota, acomp, estado)
      VALUES ($1, 1, $2, $3, $4, 'pendiente')
    `;

    for (const li of lista) {
      const veces = num(li.cantidad, 1);
      const acomp = JSON.stringify(normAcomps(li.acomps));
      const nota  = str(li.nota || '');
      const producto = str(li.producto_nombre);

      for (let i = 0; i < veces; i++) {
        await pool.query(insertItem, [ticketId, producto, nota, acomp]);
      }
    }
  }
}

/* ===================== Rutas ===================== */

/**
 * POST /api/comandas/emitir
 * body: { precuenta_id }
 * - Agrupa por sector y por “firma” (producto + acomp-set + nota) para imprimir
 * - Guarda tickets en KDS por sector (mesa_numero garantizado) con filas crudas
 *   **solo** para sectores incluidos en KDS_SECTORES_INCLUDE
 */
router.post('/emitir', async (req, res) => {
  const preId = req.body?.precuenta_id;
  if (!preId) return res.status(400).json({ error: 'precuenta_id requerido' });

  if (isLocked(preId)) {
    return res.status(202).json({ ok: true, dedup: true, message: 'Ya se están emitiendo comandas.' });
  }
  lockNow(preId);

  const enviados = [];
  const omitidos = [];
  const errores  = [];

  try {
    const header = await getHeader(preId);
    // asegurar mesa_numero (no null)
    header.mesa_numero = await ensureMesaNumero(preId, header);

    // filas crudas (para KDS) + agrupación (para impresión)
    const rowsCrudas = await getDetalleCrudoPorSector(preId);
    const groupedBySector = buildGroupsBySector(rowsCrudas);

    // Guardar en KDS usando filas CRUDAS (con whitelist)
    try {
      await saveKDS(header, rowsCrudas);
    } catch (ek) {
      console.error('KDS: error guardando', ek);
      errores.push({ kds: true, error: ek.message });
    }

    // Por cada sector con grupos, resolver impresora y enviar (no filtramos impresión)
    for (const [sector, groups] of groupedBySector.entries()) {
      if (!groups.length) continue;

      const printer = await getPrinterForSectorName(sector);
      if (!printer) {
        omitidos.push({ sector, motivo: 'Impresora no configurada/activa' });
        continue;
      }

      const html = htmlComanda(sector, header, groups);
      try {
        await printHtmlTo(printer, html, `comanda-${sector.toLowerCase()}`);
        enviados.push({ sector, printer });
      } catch (e) {
        errores.push({ sector, printer, error: e.message });
      }
    }

    res.json({ ok: errores.length === 0, enviados, omitidos, errores });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron emitir las comandas' });
  } finally {
    setTimeout(() => unlock(preId), 800);
  }
});

export default router;
