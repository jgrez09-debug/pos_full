const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'restaurante',
  password: process.env.PGPASSWORD || '1234',
  port: Number(process.env.PGPORT) || 5432,
});

module.exports = pool;
