// utils/printer.js
const pool = require('../db');

async function getPrinterBySectorId(sector_id) {
  const { rows } = await pool.query(
    `SELECT i.* FROM impresoras i
     JOIN sectores s ON s.nombre = i.nombre
     WHERE s.id = $1 AND i.activo = TRUE
     LIMIT 1`, [sector_id]
  );
  return rows[0] || null;
}

function formatTicket({ encabezado, items, footer }) {
  const lines = [];
  if (encabezado) lines.push(encabezado);
  lines.push('-----------------------------');
  for (const it of items) {
    lines.push(`${it.label}`);
    if (it.children?.length) {
      for (const ch of it.children) lines.push(`  • ${ch.label}`);
    }
  }
  lines.push('-----------------------------');
  if (footer) lines.push(footer);
  return lines.join('\n');
}

// Simulación de envío a impresora
async function printToSector(sector_id, payload) {
  const printer = await getPrinterBySectorId(sector_id);
  const ticket = formatTicket(payload);
  console.log(`\n== COMANDA => SECTOR ${sector_id} (impresora: ${printer?.nombre || 'N/A'}) ==\n${ticket}\n`);
  // TODO: implementar ESC/POS o driver real
  return true;
}

module.exports = { printToSector, formatTicket };
