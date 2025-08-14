// client/src/pages/Kds.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';
import '/src/styles.css';

const SEC_AMARILLO = 10 * 60;
const SEC_ROJO     = 15 * 60;

const PAGE_COLS = 5;
const PAGE_ROWS = 2;
const PAGE_SIZE = PAGE_COLS * PAGE_ROWS;
const AUTOROTATE_MS = 10000;

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
}

function pad3(n) {
  const v = Number(n);
  return Number.isFinite(v) ? String(v).padStart(3, '0') : String(n);
}

export default function Kds() {
  const [tickets, setTickets] = useState([]);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [auto, setAuto] = useState(true);
  const [debug, setDebug] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('kdsTheme') || 'dark');

  const pollingRef = useRef(null);
  const autoRef = useRef(null);

  // Orden estable de tarjetas
  const orderRef = useRef([]); // [ticketId,...]
  // Orden estable de ítems por ticket: ticketId -> [item_id,...]
  const itemsOrderRef = useRef(new Map());

  // Carga periódica
  useEffect(() => {
    const load = async () => {
      try {
        const r = await api('/api/kds');
        if (r?.ok) {
          const list = Array.isArray(r.data) ? r.data : [];

          // Orden estable tarjetas
          const idsNow = new Set(list.map(t => t.id));
          orderRef.current = orderRef.current.filter(id => idsNow.has(id));
          for (const t of list) {
            if (!orderRef.current.includes(t.id)) orderRef.current.push(t.id);
          }

          // Orden estable ítems por ticket
          for (const t of list) {
            const prev = itemsOrderRef.current.get(t.id) || [];
            const nowIds = new Set((t.items || []).map(it => it.item_id));
            const next = prev.filter(id => nowIds.has(id));
            for (const it of (t.items || [])) {
              if (!next.includes(it.item_id)) next.push(it.item_id);
            }
            itemsOrderRef.current.set(t.id, next);
          }
          for (const key of itemsOrderRef.current.keys()) {
            if (!idsNow.has(key)) itemsOrderRef.current.delete(key);
          }

          setTickets(list);
        }
        setError(null);
      } catch (e) {
        setError(e.message || 'Error cargando KDS');
      }
    };
    load();
    pollingRef.current = setInterval(load, 2000);
    return () => clearInterval(pollingRef.current);
  }, []);

  // Autorrotación
  useEffect(() => {
    if (!auto) { if (autoRef.current) clearInterval(autoRef.current); return; }
    autoRef.current = setInterval(() => setPage(p => p + 1), AUTOROTATE_MS);
    return () => clearInterval(autoRef.current);
  }, [auto]);

  // Orden fijo de tarjetas según orderRef
  const ordered = useMemo(() => {
    const pos = new Map(orderRef.current.map((id, idx) => [id, idx]));
    return [...tickets].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }, [tickets]);

  // Paginación
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const safePage = ((page % pages) + pages) % pages;
  const slice = ordered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Semáforo por edad/estado (borde superior)
  const ageClass = (t) => {
    if (t.estado === 'listo') return 'kds-age-green';
    if (t.estado === 'preparando') return 'kds-age-yellow';
    if (t.edad_seg >= SEC_ROJO) return 'kds-age-red';
    if (t.edad_seg >= SEC_AMARILLO) return 'kds-age-yellow';
    return 'kds-age-green';
  };

  // Ítems en orden estable por ticket
  function orderedItemsForTicket(t) {
    const order = itemsOrderRef.current.get(t.id) || [];
    const idx = new Map(order.map((id, i) => [id, i]));
    return [...(t.items || [])].sort(
      (a, b) => (idx.get(a.item_id) ?? 1e9) - (idx.get(b.item_id) ?? 1e9)
    );
  }

  async function setEstadoItem(itemId, estado) {
    try {
      const r = await api(`/api/kds/items/${itemId}`, { method: 'PATCH', body: { estado } });
      if (!r?.ok) throw new Error(r?.error || 'No se pudo actualizar el ítem');
      // refresh optimista
      setTickets(prev => prev.map(t => ({
        ...t,
        items: (t.items || []).map(it => (it.item_id === itemId ? { ...it, estado } : it))
      })));
    } catch (e) {
      setError(e.message || 'No se pudo actualizar');
      setTimeout(() => setError(null), 2500);
    }
  }

  const Item = ({ it }) => {
    const state = it.estado === 'preparando' ? 'preparando' : it.estado === 'listo' ? 'listo' : 'pendiente';
    return (
      <div
        className={`kds-itemcard ${state}`}
        title="Doble clic para marcar listo"
        onDoubleClick={() => setEstadoItem(it.item_id, 'listo')}
      >
        <div className="kds-item-line">
          <div className="kds-dot" />
          <div className="kds-item-name">
            <strong>{it.cantidad} x {it.producto}</strong>
            {it.nota ? <div className="kds-note">★ {it.nota}</div> : null}
          </div>
          <div className="kds-spacer" />
          <div className="kds-acciones">
            {it.estado !== 'preparando' && (
              <button className="kds-btn" onClick={(e)=>{ e.stopPropagation(); setEstadoItem(it.item_id,'preparando'); }}>
                Prep
              </button>
            )}
            {it.estado !== 'listo' && (
              <button className="kds-btn kds-btn-ghost" onClick={(e)=>{ e.stopPropagation(); setEstadoItem(it.item_id,'listo'); }}>
                Listo
              </button>
            )}
          </div>
        </div>

        {Array.isArray(it.acomp) && it.acomp.length > 0 && (
          <ul className="kds-acomp">
            {it.acomp.map((a, i) => <li key={i}>{it.cantidad} x {a?.nombre ?? a}</li>)}
          </ul>
        )}
      </div>
    );
  };

  function toggleTheme() {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('kdsTheme', next);
      return next;
    });
  }

  return (
    <div className={`kds-root ${theme === 'light' ? 'light' : ''}`}>
      <div className="kds-topbar">
        <div className="kds-title">KDS</div>
        <div className="kds-sub">Pedidos en curso</div>

        <div className="kds-actions">
          <button className="kds-link" onClick={()=>setDebug(d=>!d)}>{debug?'Ocultar depuración':'Depurar'}</button>
          <div className="kds-pager">
            <button className="kds-nav" onClick={()=>{ setAuto(false); setPage(p=>p-1); }}>◀</button>
            <div className="kds-pagechip">{pages===0? '0/0' : `${safePage+1}/${pages}`}</div>
            <button className="kds-nav" onClick={()=>{ setAuto(false); setPage(p=>p+1); }}>▶</button>
          </div>
          <button className="kds-link" onClick={()=>setAuto(a=>!a)}>{auto?'Auto ON':'Auto OFF'}</button>
          <button className="kds-link" onClick={toggleTheme}>Tema: {theme==='light'?'Claro':'Oscuro'}</button>
        </div>
      </div>

      {error && <div className="toast">{error}</div>}

      {/* Grilla 5x2; tarjetas con altura auto para mostrar todos los ítems */}
      <section className="kds-grid" style={{ gridTemplateRows: 'none', gridAutoRows: 'auto' }}>
        {slice.map(t => {
          // Mostramos “Pre #xxx”: preferimos pre_numero o precuenta_numero; si no, caemos a precuenta_id si es numérico
          const preRaw =
            t.pre_numero ??
            t.precuenta_numero ??
            (Number.isFinite(+t.precuenta_id) ? +t.precuenta_id : null);
          const preTxt = preRaw != null ? pad3(preRaw) : null;

          return (
            <article key={t.id} className={`kds-card ${ageClass(t)}`} style={{ height: 'auto' }}>
              <div className="kds-card-h">
                <div className="kds-card-h-left">
                  <div className="kds-mesa">
                    Mesa {t.mesa_numero}
                    {preTxt && <span className="kds-pre"> · Pre #{preTxt}</span>}
                  </div>
                  <div className="kds-meta">
                    <span>{t.sector}</span>
                    {t.mesero_nombre ? <span>· {t.mesero_nombre}</span> : null}
                    <span>· {t.estado}</span>
                  </div>
                </div>
                <div className="kds-timer">{fmtTime(t.edad_seg)}</div>
              </div>

              {/* Ítems en orden estable */}
              <div className="kds-items" style={{ maxHeight: 'none', overflow: 'visible' }}>
                {orderedItemsForTicket(t).map(it => (
                  <Item key={it.item_id} it={it} />
                ))}
              </div>

              <div className="kds-card-f">
                <span className="kds-chip">#{t.id}</span>
                <div className="kds-spacer" />
                <span className="kds-pill">{(t.items || []).length} ítem(s)</span>
              </div>
            </article>
          );
        })}
        {/* placeholders ocultos (no afectan alto variable) */}
        {Array.from({length: Math.max(0, PAGE_SIZE - slice.length)}).map((_,i)=>
          <div key={`ph-${i}`} className="kds-card-placeholder" aria-hidden style={{ display:'none' }} />
        )}
      </section>

      {debug && (
        <pre className="kds-debug">
{JSON.stringify({ theme, page: safePage+1, pages, size: slice.length, total: tickets.length }, null, 2)}
        </pre>
      )}
    </div>
  );
}
