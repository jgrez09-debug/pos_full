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
  const [pagando, setPagando] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [reimprimiendo, setReimprimiendo] = useState(false);
  const pollingRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      try { setMesas(await api('/api/mesas')); } catch {}
    };
    load();
    pollingRef.current = setInterval(load, 2000);
    return () => clearInterval(pollingRef.current);
  }, []);

  const mesasOcupadas = useMemo(
    () => mesas.filter(m => m.estado === 'ocupada'),
    [mesas]
  );

  async function abrirMesa(m) {
    setMsg('');
    setMesaSel({ id: m.id, numero: m.numero });
    const r = await api(`/api/mesas/${m.id}/precuenta`);
    if (!r?.precuenta_id) {
      setPreId(null); setDetalle({ header:{}, detalle:[] }); return;
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
    try {
      await api(`/api/precuentas/${preId}/propina`, {
        method: 'PATCH',
        body: { porcentaje: Number(propinaPct) }
      });
      await cargar(preId);
    } catch (e) {
      setMsg(e.message || 'No se pudo actualizar propina.');
    }
  }

  async function pagar(tipo) {
    if (!preId || pagando || anulando || reimprimiendo) return;
    setPagando(true);
    try {
      const body = {
        cajero_id: user.id,
        tipo,
        monto_efectivo: Number(efectivo || 0),
        monto_tarjeta: Number(tarjeta || 0),
      };
      await api(`/api/pagos/${preId}`, { method: 'POST', body });

      try {
        await api('/api/comandas/emitir', { method: 'POST', body: { precuenta_id: preId } });
        setMsg('Pago registrado y comandas enviadas.');
      } catch {
        setMsg('Pago registrado. (No se pudo enviar comandas)');
      }

      setMesaSel(null); setPreId(null); setDetalle({ header:{}, detalle:[] });
      setMesas(await api('/api/mesas'));
    } catch (e) {
      setMsg(e.message || 'Error al cobrar.');
    } finally { setPagando(false); }
  }

  async function anularPrecuenta() {
    if (!preId || pagando || anulando || reimprimiendo) return;
    setAnulando(true);
    try {
      await api(`/api/precuentas/${preId}/anular`, { method: 'POST' });
      setMsg('Precuenta anulada y mesa liberada.');
      setMesaSel(null); setPreId(null); setDetalle({ header:{}, detalle:[] });
      setMesas(await api('/api/mesas'));
    } catch (e) {
      setMsg(e.message || 'No se pudo anular la precuenta.');
    } finally { setAnulando(false); }
  }

  const lineasAgrupadas = useMemo(() => {
    const map = new Map();
    for (const li of (detalle.detalle || [])) {
      const pid = Number(li.producto_id);
      const acompIds = Array.isArray(li.acomps)
        ? Array.from(new Set(li.acomps.map(a => Number(a.id)).filter(Number.isFinite))).sort((a,b)=>a-b)
        : [];
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
    return Array.from(map.values()).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
  }, [detalle]);

  // ===== Reimprimir: guarda propina si cambió, pero IMPRIME aunque falle =====
  async function reimprimirPrecuenta() {
    if (!preId || reimprimiendo || pagando || anulando) return;
    if ((detalle?.detalle?.length || 0) === 0) {
      setMsg('No puedes reimprimir una precuenta vacía.');
      return;
    }
    setReimprimiendo(true);
    setMsg('');
    try {
      const pctServer = Number(detalle.header?.propina_porcentaje ?? 10);
      const pctLocal  = Number(propinaPct);

      if (pctLocal !== pctServer) {
        try {
          await api(`/api/precuentas/${preId}/propina`, {
            method: 'PATCH',
            body: { porcentaje: pctLocal }
          });
          await cargar(preId);
        } catch (e) {
          // No frenamos la impresión por esto
          console.warn('No se pudo actualizar propina antes de imprimir:', e);
        }
      }

      // SIEMPRE intentar imprimir
      await api(`/api/precuentas/${preId}/imprimir-precuenta`, { method: 'POST' });
      setMsg('Precuenta reimpresa con los cambios.');
    } catch (e) {
      setMsg(e.message || 'Error al reimprimir precuenta.');
    } finally {
      setReimprimiendo(false);
    }
  }

  const total = Number(detalle.header?.total_con_propina ?? 0);
  const hayProductos = (detalle?.detalle?.length || 0) > 0;
  const busy = pagando || anulando || reimprimiendo;

  return (
    <div className="m-root">
      <header className="m-header">
        <div className="m-title">Cajero</div>
        <div className="m-sub">Hola, {user?.nombre_completo || '—'}</div>
      </header>

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

      {preId && (
        <>
          <section className="card">
            <div className="row space">
              <div className="chip">
                Mesa {mesaSel?.numero} · Pre #{String(detalle.header?.numero ?? '').padStart(3,'0')}
              </div>
              <div className="row" style={{gap:8}}>
                <button className="btn-link" onClick={reimprimirPrecuenta} disabled={!hayProductos || busy}>
                  {reimprimiendo ? 'Reimprimiendo…' : 'Reimprimir'}
                </button>
                <button className="btn-link" onClick={anularPrecuenta} disabled={busy}>
                  {anulando ? 'Anulando…' : 'Anular'}
                </button>
                <button className="btn-link" onClick={() => { if (!busy){ setMesaSel(null); setPreId(null); setDetalle({header:{}, detalle:[]}); } }}>
                  Cerrar
                </button>
              </div>
            </div>

            <ul className="list">
              {lineasAgrupadas.map((g) => (
                <li key={g.firma} className="linea-prod">
                  <div className="row space gap-8">
                    <div className="flex1"><strong>{g.cantidad} x {g.nombre}</strong></div>
                    <div className="linea-precio-botones">
                      <div className="linea-precio">{money(g.precio * g.cantidad)}</div>
                      <button className="btn-ghost" disabled={busy} onClick={()=>{
                        const idItem = g.itemIds[0];
                        api(`/api/precuentas/${preId}/items/${idItem}`, { method:'PATCH', body:{op:'dec'} })
                          .then(()=>cargar(preId));
                      }}>–</button>
                      <button className="btn-ghost" disabled={busy} onClick={()=>{
                        const idItem = g.itemIds[0];
                        api(`/api/precuentas/${preId}/items/${idItem}`, { method:'PATCH', body:{op:'inc'} })
                          .then(()=>cargar(preId));
                      }}>+</button>
                      <button className="btn-link" disabled={busy} onClick={async ()=>{
                        for (const idItem of g.itemIds) {
                          await api(`/api/precuentas/${preId}/items/${idItem}`, { method:'DELETE' });
                        }
                        await cargar(preId);
                      }}>🗑</button>
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
                  disabled={busy}
                />
                <button className="btn-ghost" onClick={actualizarPropina} disabled={busy}>Actualizar</button>
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

          <section className="card">
            <div className="card-title">Pago</div>
            <div className="row">
              <input className="input" placeholder="Efectivo" inputMode="numeric"
                value={efectivo} onChange={(e)=>setEfectivo(e.target.value.replace(/\D/g,''))} disabled={busy} />
              <input className="input" placeholder="Tarjeta" inputMode="numeric"
                value={tarjeta} onChange={(e)=>setTarjeta(e.target.value.replace(/\D/g,''))} disabled={busy} />
            </div>
            <div className="row" style={{ marginTop: 8, justifyContent:'space-between' }}>
              <button className="btn-primary" disabled={busy || !hayProductos}
                onClick={()=>{ setTarjeta('0'); setEfectivo(String(total)); pagar('efectivo'); }}>
                {pagando ? 'Procesando…' : 'Pagar Efectivo'}
              </button>
              <button className="btn-primary" disabled={busy || !hayProductos}
                onClick={()=>{ setEfectivo('0'); setTarjeta(String(total)); pagar('tarjeta'); }}>
                {pagando ? 'Procesando…' : 'Pagar Tarjeta'}
              </button>
              <button className="btn-ghost" disabled={busy || !hayProductos}
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
