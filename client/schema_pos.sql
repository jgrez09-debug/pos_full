-- ==========================================================
-- POS Restaurante/Bar – Esquema base + Seed (PostgreSQL)
-- Pensado para: Mesero / Cajero / Admin, precuenta con
-- acompañamientos separados, propina editable, y ruteo a
-- sectores de impresión: BARRA, COCINA1, COCINA2.
-- ==========================================================

-- Limpieza opcional (cuidado en producción)
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- Extensiones útiles
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================
-- Catálogos y seguridad
-- =========================
CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(30) UNIQUE NOT NULL  -- admin, mesero, cajero
);

CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  usuario VARCHAR(50) UNIQUE NOT NULL,
  contrasena VARCHAR(255) NOT NULL,   -- por ahora plano; luego usar hash
  nombre_completo VARCHAR(100) NOT NULL,
  id_rol INT NOT NULL REFERENCES roles(id)
);

-- =========================
-- Impresión y ruteo
-- =========================
CREATE TABLE sectores_impresion (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(30) UNIQUE NOT NULL  -- BARRA, COCINA1, COCINA2
);

CREATE TABLE impresoras (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(30) UNIQUE NOT NULL,   -- Debe calzar con el SO/driver
  sector_id INT NOT NULL REFERENCES sectores_impresion(id),
  config JSONB DEFAULT '{}'::jsonb
);

-- =========================
-- Carta / Productos
-- =========================
CREATE TABLE categorias (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  sector_id INT NOT NULL REFERENCES sectores_impresion(id), -- a qué sector se imprime
  UNIQUE (nombre, sector_id)
);

CREATE TABLE productos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  precio INTEGER NOT NULL CHECK (precio >= 0), -- en pesos
  categoria_id INT NOT NULL REFERENCES categorias(id),
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- Acompañamientos (se listan debajo del producto en la precuenta)
CREATE TABLE acompanamientos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  precio_extra INTEGER NOT NULL CHECK (precio_extra >= 0), -- adicional
  sector_id INT NOT NULL REFERENCES sectores_impresion(id) -- generalmente cocina
);

-- Relación: qué acompañamientos están permitidos para cada producto
CREATE TABLE producto_acompanamiento (
  producto_id INT REFERENCES productos(id) ON DELETE CASCADE,
  acompanamiento_id INT REFERENCES acompanamientos(id) ON DELETE CASCADE,
  precio_extra_override INTEGER CHECK (precio_extra_override >= 0),
  PRIMARY KEY (producto_id, acompanamiento_id)
);

-- =========================
-- Mesas / Precuentas / Ítems
-- =========================
CREATE TABLE mesas (
  id SERIAL PRIMARY KEY,
  numero SMALLINT UNIQUE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'libre' -- libre | ocupada
);

-- Estados: abierta | enviada | pagada | anulada
CREATE TABLE precuentas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mesa_id INT NOT NULL REFERENCES mesas(id),
  mesero_id INT NOT NULL REFERENCES usuarios(id),
  estado VARCHAR(20) NOT NULL DEFAULT 'abierta',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  propina_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  propina_monto INTEGER NOT NULL DEFAULT 0, -- se recalcula al cerrar/pagar
  total_sin_propina INTEGER NOT NULL DEFAULT 0,
  total_con_propina INTEGER NOT NULL DEFAULT 0,
  notas TEXT
);

CREATE INDEX idx_precuentas_estado ON precuentas(estado);
CREATE INDEX idx_precuentas_mesa ON precuentas(mesa_id);

CREATE TABLE precuenta_items (
  id SERIAL PRIMARY KEY,
  precuenta_id UUID NOT NULL REFERENCES precuentas(id) ON DELETE CASCADE,
  producto_id INT NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario INTEGER NOT NULL CHECK (precio_unitario >= 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  notas TEXT
);

CREATE INDEX idx_items_precuenta ON precuenta_items(precuenta_id);

-- Acompañamientos elegidos (se muestran debajo del ítem principal)
CREATE TABLE precuenta_item_acompanamientos (
  id SERIAL PRIMARY KEY,
  precuenta_item_id INT NOT NULL REFERENCES precuenta_items(id) ON DELETE CASCADE,
  acompanamiento_id INT NOT NULL REFERENCES acompanamientos(id),
  precio_extra INTEGER NOT NULL CHECK (precio_extra >= 0),
  subtotal_extra INTEGER NOT NULL CHECK (subtotal_extra >= 0)
);

-- =========================
-- Pagos
-- =========================
-- tipo: efectivo | tarjeta | mixto
CREATE TABLE pagos (
  id SERIAL PRIMARY KEY,
  precuenta_id UUID NOT NULL REFERENCES precuentas(id) ON DELETE CASCADE,
  cajero_id INT NOT NULL REFERENCES usuarios(id),
  tipo VARCHAR(20) NOT NULL,
  monto_total INTEGER NOT NULL CHECK (monto_total >= 0),
  monto_efectivo INTEGER NOT NULL DEFAULT 0 CHECK (monto_efectivo >= 0),
  monto_tarjeta INTEGER NOT NULL DEFAULT 0 CHECK (monto_tarjeta >= 0),
  pagado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detalle JSONB DEFAULT '{}'::jsonb
);

-- =========================
-- Comandas por sector (generadas al pagar/enviar)
-- =========================
-- estado: en_cola | impresa | error
CREATE TABLE comandas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  precuenta_id UUID NOT NULL REFERENCES precuentas(id) ON DELETE CASCADE,
  sector_id INT NOT NULL REFERENCES sectores_impresion(id),
  impresora_nombre VARCHAR(30) NOT NULL,     -- ej: BARRA, COCINA1, COCINA2
  estado VARCHAR(20) NOT NULL DEFAULT 'en_cola',
  cuerpo JSONB NOT NULL,                     -- snapshot de ítems para ese sector
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  impreso_en TIMESTAMPTZ
);

CREATE INDEX idx_comandas_sector_estado ON comandas(sector_id, estado);

-- ==========================================================
-- VISTAS de apoyo (detalle ordenado: producto y luego sus acomp)
-- ==========================================================
CREATE OR REPLACE VIEW vw_precuenta_detalle_ordenado AS
WITH base AS (
  SELECT
    pi.id AS line_id,
    pi.precuenta_id,
    1 AS orden_tipo,                         -- 1 = producto
    pi.id AS orden_interno,
    p.nombre AS descripcion,
    pi.cantidad,
    pi.precio_unitario AS precio,
    pi.subtotal AS total_linea
  FROM precuenta_items pi
  JOIN productos p ON p.id = pi.producto_id
),
acomp AS (
  SELECT
    pia.id AS line_id,
    pi.precuenta_id,
    2 AS orden_tipo,                         -- 2 = acompañamiento (va debajo)
    pi.id AS orden_interno,
    '  + ' || a.nombre AS descripcion,
    1 AS cantidad,
    pia.precio_extra AS precio,
    pia.subtotal_extra AS total_linea
  FROM precuenta_item_acompanamientos pia
  JOIN precuenta_items pi ON pi.id = pia.precuenta_item_id
  JOIN acompanamientos a ON a.id = pia.acompanamiento_id
)
SELECT * FROM base
UNION ALL
SELECT * FROM acomp
ORDER BY precuenta_id, orden_interno, orden_tipo, line_id;

-- ==========================================================
-- SEED DATA
-- ==========================================================
INSERT INTO roles (nombre) VALUES
  ('admin'), ('mesero'), ('cajero');

INSERT INTO usuarios (usuario, contrasena, nombre_completo, id_rol) VALUES
  ('admin',  'admin',  'Administrador', (SELECT id FROM roles WHERE nombre='admin')),
  ('mesero', 'mesero', 'Mesero Prueba', (SELECT id FROM roles WHERE nombre='mesero')),
  ('cajero', 'cajero', 'Cajero Prueba', (SELECT id FROM roles WHERE nombre='cajero'));

-- Sectores de impresión (NOMBRES EXACTOS requeridos)
INSERT INTO sectores_impresion (nombre) VALUES ('BARRA'), ('COCINA1'), ('COCINA2');

-- Impresoras (ajusta el nombre al del SO/driver)
INSERT INTO impresoras (nombre, sector_id, config) VALUES
  ('BARRA',   (SELECT id FROM sectores_impresion WHERE nombre='BARRA'),   '{"paperWidth":"80mm"}'),
  ('COCINA1', (SELECT id FROM sectores_impresion WHERE nombre='COCINA1'), '{"paperWidth":"80mm"}'),
  ('COCINA2', (SELECT id FROM sectores_impresion WHERE nombre='COCINA2'), '{"paperWidth":"80mm"}');

-- Categorías
INSERT INTO categorias (nombre, sector_id) VALUES
  ('Bebidas',      (SELECT id FROM sectores_impresion WHERE nombre='BARRA')),
  ('Hamburguesas', (SELECT id FROM sectores_impresion WHERE nombre='COCINA1')),
  ('Pizzas',       (SELECT id FROM sectores_impresion WHERE nombre='COCINA2'));

-- Productos
INSERT INTO productos (nombre, precio, categoria_id) VALUES
  ('Cerveza Shop 500cc', 3500, (SELECT id FROM categorias WHERE nombre='Bebidas')),
  ('Pisco Sour',         4900, (SELECT id FROM categorias WHERE nombre='Bebidas')),
  ('Hamburguesa Clásica',7900, (SELECT id FROM categorias WHERE nombre='Hamburguesas')),
  ('Pizza Margarita',   10900, (SELECT id FROM categorias WHERE nombre='Pizzas'));

-- Acompañamientos
INSERT INTO acompanamientos (nombre, precio_extra, sector_id) VALUES
  ('Papas Fritas',    1500, (SELECT id FROM sectores_impresion WHERE nombre='COCINA1')),
  ('Ensalada',        1200, (SELECT id FROM sectores_impresion WHERE nombre='COCINA1')),
  ('Extra Queso',      900, (SELECT id FROM sectores_impresion WHERE nombre='COCINA2'));

-- Mapping producto ↔ acompañamientos
INSERT INTO producto_acompanamiento (producto_id, acompanamiento_id) VALUES
  ((SELECT id FROM productos WHERE nombre='Hamburguesa Clásica'), (SELECT id FROM acompanamientos WHERE nombre='Papas Fritas')),
  ((SELECT id FROM productos WHERE nombre='Hamburguesa Clásica'), (SELECT id FROM acompanamientos WHERE nombre='Ensalada')),
  ((SELECT id FROM productos WHERE nombre='Pizza Margarita'),     (SELECT id FROM acompanamientos WHERE nombre='Extra Queso'));

-- Mesas (1..10 libres)
INSERT INTO mesas (numero, estado)
SELECT g, 'libre' FROM generate_series(1,10) AS g;
