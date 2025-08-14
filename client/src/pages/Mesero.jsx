// client/src/pages/Mesero.jsx
import { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import '../styles.css';

const fmt = new Intl.NumberFormat('es-CL');
const money = (n) => `$${fmt.format(Number(n || 0))}`;
const REFRESH_MS = 3000;
const HOLD_KEY = 'mesero_hold';

const acompCache = new Map();
const NOTE_SUGGESTIONS = [
  'Sin sal','Poco picante','Bien cocido','A punto',
  'Sin hielo','Poco azúcar','Sin cebolla','Sin mayonesa'
];

export default function Mesero() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const [mesas, setMesas] = useState([]);
  const [mesaSel, setMesaSel] = useState(null);     // { id, numero }
  const [preId, setPreId] = useState(null);

  const [productos, setProductos] = useState([]);
  const [detalle, setDetalle] = useState({ header: {}, detalle: [] });

  const [search, setSearch] = useState('');
  const [categoria, setCategoria] = useState('Todas');
  const [msg, setMsg] = useState('');

  // Acompañamientos
  const [showAcomps, setShowAcomps] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [acomps, setAcomps] = useState([]);
  const [selectedAcomps, setSelectedAcomps] = useState([]);

  // Nota
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteTarget, setNoteTarget] = useState(null); // { ids: number[], nombre: string }

  // Impresión lock
  const [printing, setPrinting] = useState(false);

  /* ───────────── Helpers hold ───────────── */
  const writeHold = (pid, mid) => {
    try { localStorage.setItem(HOLD_KEY, JSON.stringify({ preId: pid, mesaId: mid, ts: Date.now() })); } catch {}
  };
  const clearHold = () => { try { localStorage.removeItem(HOLD_KEY); } catch {} };

  // Limpieza en mount: si quedó una precuenta vacía por un refresh previo, la anulamos
  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(HOLD_KEY);
        if (!raw) return;
        const hold = JSON.parse(raw || 'null');
        if (!hold?.preId) { clearHold(); return; }
        const d = await api(`/api/precuentas/${hold.preId}`);
        const count = Number(d?.detalle?.length || 0);
        if (count === 0) {
          await api(`/api/precuentas/${hold.preId}/anular`, { method: 'POST' }).catch(()=>{});
        }
      } catch {}
      clearHold();
      try { setMesas(await api('/api/mesas')); } catch {}
    })();
  }, []);

  // Intento proactivo al cerrar/recargar: si está vacía, anula por beacon
  useEffect(() => {
    const onBeforeUnload = () => {
      try { writeHold(preId, mesaSel?.id); } catch {}
      const vacia = (detalle?.detalle?.length || 0) === 0;
      if (preId && vacia && navigator.sendBeacon) {
        const url = `${location.origin}/api/precuentas/${preId}/anular`;
        const blob = new Blob([], { type: 'text/plain' });
        navigator.sendBeacon(url, blob);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [preId, mesaSel?.id, detalle?.detalle?.length]);

  /* ───────────── Data ───────────── */

  useEffect(() => {
    api('/api/mesas').then(setMesas);
    api('/api/productos').then(setProductos);
  }, []);

  const mesasDisponibles = useMemo(() => mesas.filter((m) => m.estado === 'libre'), [mesas]);

  const categorias = useMemo(() => {
    const set = new Set(productos.map((p) => p.categoria));
    return ['Todas', ...Array.from(set)];
  }, [productos]);

  const productosFiltrados = useMemo(() => {
    const txt = search.trim().toLowerCase();
    return productos
      .filter((p) => (categoria === 'Todas' ? true : p.categoria === categoria))
      .filter((p) => (txt ? (p.nombre + ' ' + p.categoria).toLowerCase().includes(txt) : true));
  }, [productos, categoria, search]);

  async function seleccionarMesa(id, numero) {
    setMsg('');
    try {
      const r = await api(`/api/mesas/${id}/seleccionar`, {
        method: 'POST',
        body: { mesero_id: user.id },
      });
      setMesaSel({ id, numero });
      const pid = r.precuenta_id || null;
      setPreId(pid);
      if (pid) writeHold(pid, id); // ← marca hold inmediato
      await cargar(pid || null, id);
      api('/api/mesas').then(setMesas);
    } catch (e) {
      setMsg(e.message || 'No se pudo tomar la mesa.');
      api('/api/mesas').then(setMesas);
    }
  }

  async function ensurePreId(pid, mesaId) {
    if (pid) return pid;
    if (!mesaId) return null;
    try {
      const r = await api(`/api/mesas/${mesaId}/precuenta`);
      if (r?.precuenta_id) {
        setPreId(r.precuenta_id);
        return r.precuenta_id;
      }
    } catch {}
    return null;
  }

  async function cargar(id, mesaIdOpt) {
    try {
      const pid = await ensurePreId(id ?? preId, mesaIdOpt ?? mesaSel?.id);
      if (!pid) { setDetalle({ header: {}, detalle: [] }); return; }
      const d = await api(`/api/precuentas/${pid}`);
      setDetalle(d);
    } catch {
      setDetalle({ header: {}, detalle: [] });
    }
  }

  /* ───────── Añadir productos / acomp ───────── */

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
      clearHold(); // ← ya tiene 1er ítem
      await cargar(pid);
    } else {
      setSelectedProduct(p);
      setAcomps(list);
      setSelectedAcomps([]);
      setShowAcomps(true);
    }
  }

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
    clearHold(); // ← 1er ítem agregado
    await cargar(pid);
    setShowAcomps(false);
  }

  /* ───────── Agrupar (producto + acompSet + nota) ───────── */

  const lineasAgrupadas = useMemo(() => {
    const out = [];
    const map = new Map();
    (detalle.detalle || []).forEach((li) => {
      const acompIds = (li.acomps || []).map((a) => Number(a.id)).filter(Number.isFinite).sort((a, b) => a - b);
      const notaNorm = String(li.nota || '').trim().toLowerCase();
      const firma = `${li.producto_id}#${acompIds.join(',')}#${notaNorm}`;
      if (!map.has(firma)) {
        map.set(firma, {
          firma,
          producto_id: li.producto_id,
          nombre: li.nombre_producto || li.descripcion,
          precio: Number(li.precio_unitario || 0),
          acomps: (li.acomps || []).map(a => ({
            id: Number(a.id), nombre: a.nombre, precio_extra: Number(a.precio_extra || 0)
          })),
          cantidad: 0,
          itemIds: [],
          nota: String(li.nota || ''),
        });
      }
      const g = map.get(firma);
      g.cantidad += Number(li.cantidad || 1);
      g.itemIds.push(li.item_id);
    });
    map.forEach((v) => out.push(v));
    out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return out;
  }, [detalle]);

  /* ───────── +/- / eliminar ───────── */

  async function incLinea(g) {
    const pid = await ensurePreId(preId, mesaSel?.id);
    if (!pid) return;
    await api(`/api/precuentas/${pid}/items/${g.itemIds[0]}`, { method: 'PATCH', body: { op: 'inc' } });
    await cargar(pid);
  }

  async function decLinea(g) {
    const pid = await ensurePreId(preId, mesaSel?.id);
    if (!pid) return;
    await api(`/api/precuentas/${pid}/items/${g.itemIds[0]}`, { method: 'PATCH', body: { op: 'dec' } });
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

  /* ───────── Nota ───────── */

  function abrirNota(g) {
    setNoteTarget({ ids: g.itemIds, nombre: g.nombre });
    setNoteText(String(g.nota || ''));
    setShowNote(true);
  }

  async function guardarNota() {
    const pid = await ensurePreId(preId, mesaSel?.id);
    if (!pid || !noteTarget) return;
    const text = (noteText || '').trim().slice(0, 160);
    try {
      for (const idItem of noteTarget.ids) {
        await api(`/api/precuentas/${pid}/items/${idItem}/nota`, {
          method: 'PATCH',
          body: { nota: text }
        });
      }
      await cargar(pid);
      setShowNote(false);
      setNoteText('');
      setNoteTarget(null);
      setMsg('Nota guardada.');
    } catch (e) {
      setMsg(e.message || 'No se pudo guardar la nota.');
    }
  }

  /* ───────── Anular / Cerrar / Imprimir ───────── */

  async function anularPrecuenta() {
    const pid = await ensurePreId(preId, mesaSel?.id);
    if (!pid) return;
    try {
      await api(`/api/precuentas/${pid}/anular`, { method: 'POST' });
      clearHold();
      setMsg('Precuenta anulada y mesa liberada.');
      setMesaSel(null);
      setPreId(null);
      setDetalle({ header: {}, detalle: [] });
      api('/api/mesas').then(setMesas);
    } catch (e) {
      setMsg(e.message || 'No se pudo anular la precuenta.');
    }
  }

  // NUEVO: Cerrar → si está vacía, libera mesa (anula); si no, solo vuelve al listado
  async function cerrarVistaMesa() {
    try {
      const pid = await ensurePreId(preId, mesaSel?.id);
      const vacia = Number(detalle?.detalle?.length || 0) === 0;
      if (pid && vacia) {
        await api(`/api/precuentas/${pid}/anular`, { method: 'POST' }).catch(()=>{});
      }
    } finally {
      clearHold();
      setMesaSel(null);
      setPreId(null);
      setDetalle({ header: {}, detalle: [] });
      api('/api/mesas').then(setMesas);
    }
  }

  const subtotal = Number(detalle?.header?.total_sin_propina ?? 0);
  const propinaPorcentaje = Number(detalle?.header?.propina_porcentaje ?? 10);
  const propinaMonto =
    detalle?.header?.propina_monto != null
      ? Number(detalle.header.propina_monto)
      : Math.round((subtotal * propinaPorcentaje) / 100);
  const totalConPropina = Number(detalle?.header?.total_con_propina ?? (subtotal + propinaMonto));
  const hayProductos = Number(detalle?.detalle?.length ?? 0) > 0;

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
      clearHold();
      setMsg(r?.dedup ? 'Ya se estaba imprimiendo…' : 'Precuenta enviada a la impresora.');
      setMesaSel(null); setPreId(null); setDetalle({ header: {}, detalle: [] });
      api('/api/mesas').then(setMesas);
    } catch (e) {
      try {
        const pid2 = await ensurePreId(null, mesaSel?.id);
        if (pid2) {
          const r2 = await api(`/api/precuentas/${pid2}/imprimir-precuenta`, {
            method: 'POST', body: { direct: true }
          });
          clearHold();
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
    const id = setInterval(async () => {
      if (document.hidden) return;
      if (showAcomps || showNote) return;
      await refreshNow();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [preId, showAcomps, showNote, mesaSel?.id]);

  /* ───────── UI ───────── */

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
              <button className="btn-link" onClick={cerrarVistaMesa}>Cerrar</button>
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
                  <div className="flex1">
                    <strong>{g.cantidad} x {g.nombre}</strong>
                    {!!g.nota && <div className="muted" style={{marginTop:4}}>★ {g.nota}</div>}
                  </div>
                  <div className="linea-precio-botones">
                    <div className="linea-precio">{money(g.precio * g.cantidad)}</div>
                    <button className="btn-ghost" onClick={() => decLinea(g)} aria-label="disminuir">–</button>
                    <button className="btn-ghost" onClick={() => incLinea(g)} aria-label="aumentar">+</button>
                    <button className="btn-ghost" title="Nota" onClick={() => abrirNota(g)} aria-label="nota">📝</button>
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

      {/* Sheet acompañamientos */}
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

      {/* Sheet nota */}
      {showNote && (
        <div className="sheet-backdrop" onClick={() => setShowNote(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">Nota para cocina/barra</div>

            <div className="sheet-body" style={{ display:'block' }}>
              <textarea
                className="input"
                placeholder="Ej.: sin sal, bien cocida, sin hielo…"
                value={noteText}
                onChange={(e)=>setNoteText(e.target.value.slice(0,160))}
                rows={3}
                style={{ width:'100%' }}
              />
              <div className="muted" style={{ textAlign:'right', marginTop:6 }}>
                {noteText.length}/160
              </div>

              <div className="sheet-body" style={{ marginTop:8, gap:6, display:'flex', flexWrap:'wrap' }}>
                {NOTE_SUGGESTIONS.map(txt => {
                  const on = (noteText || '').toLowerCase().includes(txt.toLowerCase());
                  return (
                    <button
                      key={txt}
                      type="button"
                      className={`note-pill ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      onClick={() => {
                        setNoteText(prev => {
                          const present = (prev || '').toLowerCase().includes(txt.toLowerCase());
                          if (present) {
                            return prev.replace(new RegExp(`\\b${txt}\\b`, 'i'), '').replace(/\s{2,}/g,' ').trim();
                          }
                          return (prev ? `${prev} ${txt}` : txt).slice(0,160);
                        });
                      }}
                    >
                      {txt}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="sheet-actions">
              <button className="btn-ghost" onClick={() => setShowNote(false)}>Cerrar</button>
              <button className="btn-ghost" onClick={() => setNoteText('')}>Borrar</button>
              <button className="btn-primary" onClick={guardarNota} disabled={!noteTarget}>
                Guardar nota
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
