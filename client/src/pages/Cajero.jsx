import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';
import '/src/styles.css';

const fmt = new Intl.NumberFormat('es-CL');
const money = (n) => `$${fmt.format(Number(n || 0))}`;

export default function Cajero() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const [mesas, setMesas] = useState([]);
  const [mesaSel, setMesaSel] = useState(null); // {id, numero}
  const [preId, setPreId] = useState(null);
  const [detalle, setDetalle] = useState({ header:{}, detalle:[] });

  const [efectivo, setEfectivo] = useState('');
  const [tarjeta, setTarjeta] = useState('');
  const [propinaPct, setPropinaPct] = useState(10);

  const [msg, setMsg] = useState('');
  const [pagando, setPagando] = useState(false); // ← evita doble click
  const pollingRef = useRef(null);

  // === Polling de mesas (cada 2s)
  useEffect(() => {
    const load = async () => {
      try {
        const data = await api('/api/mesas');
        setMesas(data);
      } catch { /* ignore */ }
    };
    load();
    pollingRef.current = setInterval(load, 2000);
    return () => clearInterval(pollingRef.current);
  }, []);

  const mesasOcupadas = useMemo(
    () => mesas.filter(m => m.estado === 'ocupada'),
    [mesas]
  );

  // Cargar precuenta de una mesa ocupada
  async function abrirMesa(m) {
    setMsg('');
    setMesaSel({ id: m.id, numero: m.numero });

    const r = await api(`/api/mesas/${m.id}/precuenta`);
    if (!r?.precuenta_id) {
      setPreId(null);
      setDetalle({ header:{}, detalle:[] });
      return;
    }
    setPreId(r.precuenta_id);
    await cargar(r.precuenta_id);
  }

  async function cargar(id) {
    const d = await api(`/api/precuentas/${id}`);
    setDetalle(d);
    setPropinaPct(Number(d.header?.propina_porcentaje ?? 10));
    const total = Number(d.header?.total_con_propina ?? 0);
    setTarjeta(String(total));
    setEfectivo('');
  }

  async function actualizarPropina() {
    if (!preId) return;
    await api(`/api/precuentas/${preId}/propina`, {
      method: 'PATCH',
      body: { porcentaje: Number(propinaPct) }
    });
    await cargar(preId);
  }

  async function pagar(tipo) {
    if (!preId || pagando) return;
    setPagando(true);
    try {
      const body = {
        cajero_id: user.id,
        tipo,
        monto_efectivo: Number(efectivo || 0),
        monto_tarjeta: Number(tarjeta || 0),
      };
      await api(`/api/pagos/${preId}`, { method: 'POST', body });

      // Emitir comandas SOLO una vez (mientras "pagando" está true, los botones quedan deshabilitados)
      try {
        await api('/api/comandas/emitir', {
          method: 'POST',
          body: { precuenta_id: preId }
        });
        setMsg('Pago registrado y comandas enviadas.');
      } catch (e) {
        setMsg(`Pago registrado. (No se pudo enviar comandas)`);
      }

      // limpiar UI y refrescar mesas
      setMesaSel(null);
      setPreId(null);
      setDetalle({ header:{}, detalle:[] });
      const data = await api('/api/mesas');
      setMesas(data);
    } catch (e) {
      setMsg(e.message || 'Error al cobrar.');
    } finally {
      setPagando(false);
    }
  }

  // ====== Controles de líneas (igual que Mesero) ======
  const lineasAgrupadas = useMemo(() => {
  const map = new Map();

  for (const li of (detalle.detalle || [])) {
    const pid = Number(li.producto_id);

    // Normalizar acomp: números, sin null/NaN, únicos y ordenados
    const acompIds = Array.isArray(li.acomps)
      ? Array.from(new Set(
          li.acomps.map(a => Number(a.id)).filter(n => Number.isFinite(n))
        )).sort((a,b)=>a-b)
      : [];

    // Firma estable: producto + set de acomp ordenado
    const firma = JSON.stringify({ pid, a: acompIds });

    if (!map.has(firma)) {
      map.set(firma, {
        firma,
        producto_id: pid,
        nombre: li.nombre_producto || li.descripcion,
        precio: Number(li.precio_unitario || 0),
        acomps: (li.acomps || []).map(a => ({
          id: Number(a.id),
          nombre: a.nombre,
          precio_extra: Number(a.precio_extra || 0),
        })),
        cantidad: 0,
        itemIds: [],
      });
    }

    const g = map.get(firma);
    g.cantidad += Number(li.cantidad || 1);
    g.itemIds.push(li.item_id);
  }

  return Array.from(map.values())
    .sort((a,b) => a.nombre.localeCompare(b.nombre, 'es'));
}, [detalle]);

  // Reimprimir precuenta
  async function reimprimirPrecuenta() {
    if (!preId) return;
    const hayProductos = (detalle?.detalle?.length || 0) > 0;
    if (!hayProductos) {
      setMsg('No puedes reimprimir una precuenta vacía.');
      return;
    }
    try {
      await api(`/api/precuentas/${preId}/imprimir-precuenta`, { method: 'POST' });
      setMsg('Precuenta reimpresa con los cambios.');
      await cargar(preId);
    } catch (e) {
      setMsg(e.message || 'Error al reimprimir precuenta.');
    }
  }

  const total = Number(detalle.header?.total_con_propina ?? 0);
  const hayProductos = (detalle?.detalle?.length || 0) > 0;

  return (
    <div className="m-root">
      <header className="m-header">
        <div className="m-title">Cajero</div>
        <div className="m-sub">Hola, {user?.nombre_completo || '—'}</div>
      </header>

      {/* Mesas ocupadas en tiempo real */}
      <section className="card">
        <div className="card-title row space">
          <span>Mesas ocupadas</span>
          <button className="btn-link" onClick={async()=>setMesas(await api('/api/mesas'))}>Actualizar</button>
        </div>
        {mesasOcupadas.length === 0 && <div className="muted">No hay mesas ocupadas.</div>}
        <div className="grid">
          {mesasOcupadas.map(m => (
            <button key={m.id} className="btn-tile" onClick={() => abrirMesa(m)}>
              Mesa {m.numero}
            </button>
          ))}
        </div>
      </section>

      {/* Precuenta seleccionada */}
      {preId && (
        <>
          <section className="card">
            <div className="row space">
              <div className="chip">
                Mesa {mesaSel?.numero} · Pre #{String(detalle.header?.numero ?? '').padStart(3,'0')}
              </div>
              <div className="row" style={{gap:8}}>
                <button className="btn-link" onClick={reimprimirPrecuenta} disabled={!hayProductos || pagando}>
                  Reimprimir
                </button>
                <button
                  className="btn-link"
                  onClick={() => { if (!pagando){ setMesaSel(null); setPreId(null); setDetalle({header:{}, detalle:[]}); } }}
                >
                  Cerrar
                </button>
              </div>
            </div>

            {/* Ticket */}
            <ul className="list">
              {lineasAgrupadas.map((g) => (
                <li key={g.firma} className="linea-prod">
                  <div className="row space gap-8">
                    <div className="flex1">
                      <strong>{g.cantidad} x {g.nombre}</strong>
                    </div>
                    <div className="linea-precio-botones">
                      <div className="linea-precio">{money(g.precio * g.cantidad)}</div>
                      <button className="btn-ghost" onClick={() => decLinea(g)} aria-label="disminuir" disabled={pagando}>–</button>
                      <button className="btn-ghost" onClick={() => incLinea(g)} aria-label="aumentar" disabled={pagando}>+</button>
                      <button className="btn-link" onClick={() => delLinea(g)} aria-label="eliminar" disabled={pagando}>🗑</button>
                    </div>
                  </div>

                  {Array.isArray(g.acomps) && g.acomps.length > 0 && (
                    <ul className="lista-acomps">
                      {g.acomps.map((a) => (
                        <li key={a.id} className="row space item-acomp">
                          <div className="muted">{g.cantidad} x {a.nombre}</div>
                          <div className="minw-90 text-right">{money(a.precio_extra * g.cantidad)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            {/* Totales y propina */}
            <div className="row">
              <span className="muted">Subtotal</span>
              <span>{money(detalle.header?.total_sin_propina ?? 0)}</span>
            </div>

            <div className="row">
              <span className="muted">Propina %</span>
              <div className="row" style={{ marginLeft: 'auto' }}>
                <input
                  className="input"
                  style={{ width: 90 }}
                  type="number"
                  step="0.5"
                  value={propinaPct}
                  onChange={(e)=>setPropinaPct(e.target.value)}
                  disabled={pagando}
                />
                <button className="btn-ghost" onClick={actualizarPropina} disabled={pagando}>Actualizar</button>
              </div>
            </div>

            <div className="row">
              <span className="muted">Propina</span>
              <span>{money(detalle.header?.propina_monto ?? 0)}</span>
            </div>

            <div className="row total">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
          </section>

          {/* Pago */}
          <section className="card">
            <div className="card-title">Pago</div>
            <div className="row">
              <input
                className="input"
                placeholder="Efectivo"
                inputMode="numeric"
                value={efectivo}
                onChange={(e)=>setEfectivo(e.target.value.replace(/\D/g,''))}
                disabled={pagando}
              />
              <input
                className="input"
                placeholder="Tarjeta"
                inputMode="numeric"
                value={tarjeta}
                onChange={(e)=>setTarjeta(e.target.value.replace(/\D/g,''))}
                disabled={pagando}
              />
            </div>
            <div className="row" style={{ marginTop: 8, justifyContent:'space-between' }}>
              <button className="btn-primary" disabled={pagando || !hayProductos}
                onClick={()=>{ setTarjeta('0'); setEfectivo(String(total)); pagar('efectivo'); }}>
                {pagando ? 'Procesando…' : 'Pagar Efectivo'}
              </button>
              <button className="btn-primary" disabled={pagando || !hayProductos}
                onClick={()=>{ setEfectivo('0'); setTarjeta(String(total)); pagar('tarjeta'); }}>
                {pagando ? 'Procesando…' : 'Pagar Tarjeta'}
              </button>
              <button className="btn-ghost" disabled={pagando || !hayProductos}
                onClick={()=>pagar('mixto')}>
                {pagando ? 'Procesando…' : 'Pagar Mixto'}
              </button>
            </div>
          </section>
        </>
      )}

      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
