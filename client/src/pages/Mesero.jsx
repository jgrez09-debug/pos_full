// client/src/pages/Mesero.jsx
import { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import '../styles.css';

const fmt = new Intl.NumberFormat('es-CL');
const money = (n) => `$${fmt.format(Number(n || 0))}`;
const REFRESH_MS = 3000;
const acompCache = new Map();

export default function Mesero() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const [mesas, setMesas] = useState([]);
  const [mesaSel, setMesaSel] = useState(null); // { id, numero }
  const [preId, setPreId] = useState(null);

  const [productos, setProductos] = useState([]);
  const [detalle, setDetalle] = useState({ header: {}, detalle: [] });

  const [search, setSearch] = useState('');
  const [categoria, setCategoria] = useState('Todas');
  const [msg, setMsg] = useState('');

  // modal acomp
  const [showAcomps, setShowAcomps] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [acomps, setAcomps] = useState([]);
  const [selectedAcomps, setSelectedAcomps] = useState([]);

  // impresión: anti-doble click
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    api('/api/mesas').then(setMesas);
    api('/api/productos').then(setProductos);
  }, []);

  const mesasDisponibles = useMemo(
    () => mesas.filter((m) => m.estado === 'libre'),
    [mesas]
  );

  const categorias = useMemo(() => {
    const set = new Set(productos.map((p) => p.categoria));
    return ['Todas', ...Array.from(set)];
  }, [productos]);

  const productosFiltrados = useMemo(() => {
    const txt = search.trim().toLowerCase();
    return productos
      .filter((p) => (categoria === 'Todas' ? true : p.categoria === categoria))
      .filter((p) =>
        txt ? (p.nombre + ' ' + p.categoria).toLowerCase().includes(txt) : true
      );
  }, [productos, categoria, search]);

  async function seleccionarMesa(id, numero) {
    setMsg('');
    try {
      const r = await api(`/api/mesas/${id}/seleccionar`, {
        method: 'POST',
        body: { mesero_id: user.id },
      });
      setMesaSel({ id, numero });
      setPreId(r.precuenta_id || null);
      await cargar(r.precuenta_id || null, id);
      api('/api/mesas').then(setMesas);
    } catch (e) {
      setMsg(e.message || 'No se pudo tomar la mesa.');
      api('/api/mesas').then(setMesas);
    }
  }

  // === Fallback robusto del id de precuenta ===
  async function ensurePreId(pid, mesaId) {
    if (pid) return pid;
    if (!mesaId) return null;
    try {
      const r = await api(`/api/mesas/${mesaId}/precuenta`);
      if (r?.precuenta_id) {
        setPreId(r.precuenta_id);
        return r.precuenta_id;
      }
    } catch { /* silent */ }
    return null;
  }

  // === Cargar detalle (con reintento si el id quedó viejo) ===
  async function cargar(id, mesaIdOpt) {
    try {
      const pid = await ensurePreId(id ?? preId, mesaIdOpt ?? mesaSel?.id);
      if (!pid) { setDetalle({ header: {}, detalle: [] }); return; }
      const d = await api(`/api/precuentas/${pid}`);
      setDetalle(d);
    } catch (e) {
      if (String(e?.message || '').startsWith('Not Found')) {
        try {
          const pid2 = await ensurePreId(null, mesaSel?.id);
          if (pid2) {
            const d2 = await api(`/api/precuentas/${pid2}`);
            setPreId(pid2);
            setDetalle(d2);
            return;
          }
        } catch {}
      }
      setDetalle({ header: {}, detalle: [] });
    }
  }

  // === Agregar producto (si tiene acomp abre modal) ===
  async function handleAddProduct(p) {
    const pid = await ensurePreId(preId, mesaSel?.id);
    if (!pid) { setMsg('No hay precuenta abierta para esta mesa.'); return; }

    let list = acompCache.get(p.id);
    if (!list) {
      list = await api(`/api/productos/${p.id}/acompanamientos`);
      acompCache.set(p.id, list);
    }
    if (!list.length) {
      await api(`/api/precuentas/${pid}/items`, { method: 'POST', body: { producto_id: p.id } });
      await cargar(pid);
    } else {
      setSelectedProduct(p);
      setAcomps(list);
      setSelectedAcomps([]);
      setShowAcomps(true);
    }
  }

  // Confirmar modal
  async function confirmarAgregarItem() {
    const pid = await ensurePreId(preId, mesaSel?.id);
    if (!pid || !selectedProduct) return;

    const r = await api(`/api/precuentas/${pid}/items`, {
      method: 'POST',
      body: { producto_id: selectedProduct.id },
    });
    for (const aid of selectedAcomps) {
      await api(`/api/precuentas/${pid}/items/${r.item_id}/acompanamientos`, {
        method: 'POST', body: { acompanamiento_id: aid }
      });
    }
    await cargar(pid);
    setShowAcomps(false);
  }

  // === Agrupar líneas: producto + set de acomp (ids numéricos, únicos y ordenados) ===
  const lineasAgrupadas = useMemo(() => {
    const map = new Map();

    for (const li of (detalle.detalle || [])) {
      const pid = Number(li.producto_id);

      const acompIds = Array.isArray(li.acomps)
        ? Array.from(new Set(
            li.acomps.map(a => Number(a.id)).filter(n => Number.isFinite(n))
          )).sort((a,b)=>a-b)
        : [];

      // firma estable (igual a Cajero)
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
      .sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
  }, [detalle]);

  // +/- / eliminar (siempre asegurando preId)
  async function incLinea(g) {
    const pid = await ensurePreId(preId, mesaSel?.id);
    if (!pid) return;
    const idItem = g.itemIds[0];
    await api(`/api/precuentas/${pid}/items/${idItem}`, { method: 'PATCH', body: { op: 'inc' } });
    await cargar(pid);
  }
  async function decLinea(g) {
    const pid = await ensurePreId(preId, mesaSel?.id);
    if (!pid) return;
    const idItem = g.itemIds[0];
    await api(`/api/precuentas/${pid}/items/${idItem}`, { method: 'PATCH', body: { op: 'dec' } });
    await cargar(pid);
  }
  async function delLinea(g) {
    const pid = await ensurePreId(preId, mesaSel?.id);
    if (!pid) return;
    for (const idItem of g.itemIds) {
      await api(`/api/precuentas/${pid}/items/${idItem}`, { method: 'DELETE' });
    }
    await cargar(pid);
  }

  // anular
  async function anularPrecuenta() {
    const pid = await ensurePreId(preId, mesaSel?.id);
    if (!pid) return;
    try {
      await api(`/api/precuentas/${pid}/anular`, { method: 'POST' });
      setMsg('Precuenta anulada y mesa liberada.');
      setMesaSel(null);
      setPreId(null);
      setDetalle({ header: {}, detalle: [] });
      api('/api/mesas').then(setMesas);
    } catch (e) {
      setMsg(e.message || 'No se pudo anular la precuenta.');
    }
  }

  // Totales (desde backend)
  const subtotal = Number(detalle?.header?.total_sin_propina ?? 0);
  const propinaPorcentaje = Number(detalle?.header?.propina_porcentaje ?? 10);
  const propinaMonto =
    detalle?.header?.propina_monto != null
      ? Number(detalle.header.propina_monto)
      : Math.round((subtotal * propinaPorcentaje) / 100);
  const totalConPropina = Number(detalle?.header?.total_con_propina ?? (subtotal + propinaMonto));
  const hayProductos = Number(detalle?.detalle?.length ?? 0) > 0;

  // Imprimir (bloqueo + fallback id)
  async function imprimirPrecuenta() {
    const pid = await ensurePreId(preId, mesaSel?.id);
    if (!pid || printing) return;
    if (!hayProductos) { setMsg('No puedes imprimir una precuenta vacía.'); return; }

    setPrinting(true);
    setMsg('');
    try {
      const r = await api(`/api/precuentas/${pid}/imprimir-precuenta`, {
        method: 'POST', body: { direct: true }
      });
      setMsg(r?.dedup ? 'Ya se estaba imprimiendo…' : 'Precuenta enviada a la impresora.');
      // Volver a selector
      setMesaSel(null); setPreId(null); setDetalle({ header: {}, detalle: [] });
      api('/api/mesas').then(setMesas);
    } catch (e) {
      try {
        const pid2 = await ensurePreId(null, mesaSel?.id);
        if (pid2) {
          const r2 = await api(`/api/precuentas/${pid2}/imprimir-precuenta`, {
            method: 'POST', body: { direct: true }
          });
          setMsg(r2?.dedup ? 'Ya se estaba imprimiendo…' : 'Precuenta enviada a la impresora.');
          setMesaSel(null); setPreId(null); setDetalle({ header: {}, detalle: [] });
          api('/api/mesas').then(setMesas);
        } else {
          setMsg(e.message || 'Error al imprimir precuenta.');
        }
      } catch {
        setMsg(e.message || 'Error al imprimir precuenta.');
      }
    } finally {
      setTimeout(() => setPrinting(false), 600);
    }
  }

  // auto-refresh
  async function refreshNow() {
    try {
      if (preId || mesaSel?.id) await cargar(preId, mesaSel?.id);
      api('/api/mesas').then(setMesas);
    } catch {}
  }
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      if (showAcomps) return;
      await refreshNow();
    };
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  }, [preId, showAcomps, mesaSel?.id]);

  return (
    <div className="m-root">
      <header className="m-header">
        <div className="m-title">Mesero</div>
        <div className="m-sub">Hola, {user?.nombre_completo || '—'}</div>
      </header>

      {!mesaSel && (
        <section className="card">
          <div className="card-title row space">
            <span>Mesas disponibles</span>
            <button className="btn-link" onClick={refreshNow}>Actualizar</button>
          </div>
          {mesasDisponibles.length === 0 && <div className="muted">No hay mesas libres por ahora.</div>}
          <div className="grid">
            {mesasDisponibles.map((m) => (
              <button key={m.id} className="btn-tile" onClick={() => seleccionarMesa(m.id, m.numero)}>
                Mesa {m.numero}
              </button>
            ))}
          </div>
        </section>
      )}

      {mesaSel && (
        <section className="card m-sticky">
          <div className="row space">
            <div className="chip">Mesa {mesaSel.numero}</div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn-link" onClick={refreshNow}>Actualizar</button>
              <button className="btn-link" onClick={anularPrecuenta}>Anular</button>
              <button className="btn-link" disabled title="Deshabilitado temporalmente">Cambiar mesa</button>
            </div>
          </div>

          <div className="row">
            <input className="input" placeholder="Buscar producto…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="grid">
            {productosFiltrados.map((p) => (
              <button key={p.id} className="btn-card" onClick={() => handleAddProduct(p)}>
                <div className="btn-card-title">{p.nombre}</div>
                <div className="btn-card-sub">{p.categoria}</div>
                <div className="btn-card-price">{money(p.precio)}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {mesaSel && (
        <section className="card">
          <div className="card-title">
            Precuenta #{String(detalle.header?.numero ?? '').padStart(3, '0')}
          </div>

          <ul className="list">
            {lineasAgrupadas.map((g) => (
              <li key={g.firma} className="linea-prod">
                <div className="row space gap-8">
                  <div className="flex1"><strong>{g.cantidad} x {g.nombre}</strong></div>
                  <div className="linea-precio-botones">
                    <div className="linea-precio">{money(g.precio * g.cantidad)}</div>
                    <button className="btn-ghost" onClick={() => decLinea(g)} aria-label="disminuir">–</button>
                    <button className="btn-ghost" onClick={() => incLinea(g)} aria-label="aumentar">+</button>
                    <button className="btn-link"  onClick={() => delLinea(g)} aria-label="eliminar">🗑</button>
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

          <div className="row"><span className="muted">Subtotal</span><span>{money(subtotal)}</span></div>
          <div className="row"><span className="muted">Propina {propinaPorcentaje}%</span><span>{money(propinaMonto)}</span></div>
          <div className="row total"><span>Total</span><span>{money(totalConPropina)}</span></div>
        </section>
      )}

      {mesaSel && (
        <div className="bottom-bar" style={{ gap: 12 }}>
          <div className="bottom-total">Total {money(totalConPropina)}</div>
          <button
            className="btn-primary"
            disabled={!preId || !hayProductos || printing}
            onClick={imprimirPrecuenta}
            onDoubleClick={(e) => e.preventDefault()}
            aria-busy={printing}
            style={{ minWidth: 180 }}
            title={!hayProductos ? 'Agrega productos antes de imprimir' : (printing ? 'Imprimiendo…' : 'Imprimir precuenta')}
          >
            {printing ? 'Imprimiendo…' : 'Imprimir precuenta'}
          </button>
        </div>
      )}

      {msg && <div className="toast">{msg}</div>}

      {showAcomps && (
        <div className="sheet-backdrop" onClick={() => setShowAcomps(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">Acompañamientos</div>
            {acomps.length === 0 && <div className="muted">Este producto no tiene acompañamientos.</div>}
            <div className="sheet-body">
              {acomps.map((a) => (
                <label key={a.id} className="check">
                  <input
                    type="checkbox"
                    checked={selectedAcomps.includes(a.id)}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setSelectedAcomps(prev => on ? [...prev, a.id] : prev.filter(x => x !== a.id));
                    }}
                  />
                  <span>{a.nombre}</span>
                  <span className="muted">{Number(a.precio_extra) > 0 ? `+${money(a.precio_extra)}` : ''}</span>
                </label>
              ))}
            </div>
            <div className="sheet-actions">
              <button className="btn-ghost" onClick={() => setShowAcomps(false)}>Cancelar</button>
              <button className="btn-primary" onClick={confirmarAgregarItem}>Agregar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
