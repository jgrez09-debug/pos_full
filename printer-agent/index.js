// CJS o ESM con type:module; aquí uso CJS común
require('dotenv').config();
const axios = require('axios');

const baseURL = process.env.BACKEND_URL || 'http://localhost:3001';
const token   = process.env.PRINTER_TOKEN; // DEBE ser idéntico al del server
if (!token) {
  console.error('Falta PRINTER_TOKEN en el .env del printer-agent');
  process.exit(1);
}

const http = axios.create({
  baseURL,
  timeout: 8000,
  headers: { Authorization: `Bearer ${token}` },
});

// Canales a “escuchar”
const CHANNELS = [
  'ticket_precuenta',
  'comanda_cocina',
  'comanda_cocina2',
  'comanda_barra',
];

// Simula impresión y hace ACK
async function processJob(job) {
  // job: { id, tipo, impresora_nombre, cuerpo, ... }
  try {
    // Aquí va tu lógica de impresión real (ESC/POS, driver, etc.)
    // Por ahora sólo simulamos con un console.log:
    console.log(`[PRINT][${job.impresora_nombre}] tipo=${job.tipo} payload=`, job.cuerpo);

    // ACK OK
    await http.post(`/api/print/${job.id}/ack`, { ok: true });
  } catch (e) {
    // ACK ERROR
    await http.post(`/api/print/${job.id}/ack`, {
      ok: false,
      error: e?.message || 'print failed',
    });
  }
}

// Poll de un canal
async function pollChannel(canal) {
  try {
    const { data } = await http.get('/api/print/next', { params: { canal } });
    if (data?.job) {
      await processJob(data.job);
    }
  } catch (e) {
    const status = e.response?.status;
    console.log(`[${canal}] Request failed${status ? ` status ${status}` : ''}:`, e.message);
  }
}

function start() {
  console.log(`Printer-agent conectado a ${baseURL}`);
  // poll simple cada 2s por canal
  setInterval(() => CHANNELS.forEach(pollChannel), 2000);
}

start();
