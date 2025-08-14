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
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
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

  useEffect(() => {
    const load = async () => {
      try {
        const r = await api('/api/kds');
        if (r?.ok) setTickets(r.data || []);
        setError(null);
      } catch (e) {
        setError(e.message || 'Error cargando KDS');
      }
    };
    load();
    pollingRef.current = setInterval(load, 2000);
    return () => clearInterval(pollingRef.current);
  }, []);

  useEffect(() => {
    if (!auto) { if (autoRef.current) clearInterval(autoRef.current); return; }
    autoRef.current = setInterval(() => setPage(p => p + 1), AUTOROTATE_MS);
    return () => clearInterval(autoRef.current);
  }, [auto]);

  const ordered = useMemo(
    () => [...tickets].sort((a, b) => a.edad_seg - b.edad_seg),
    [tickets]
  );

  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const safePage = ((page % pages) + pages) % pages;
  const slice = ordered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const ageClass = (t) => {
    if (t.estado === 'listo') return 'kds-age-green';
    if (t.estado === 'preparando') return 'kds-age-yellow';
    if (t.edad_seg >= SEC_ROJO) return 'kds-age-red';
    if (t.edad_seg >= SEC_AMARILLO) return 'kds-age-yellow';
    return 'kds-age-green';
  };

  async function setEstadoItem(itemId, estado) {
    try {
      const r = await api(`/api/kds/items/${itemId}`, { method: 'PATCH', body: { estado } });
      if (!r?.ok) throw new Error(r?.error || 'No se pudo actualizar el ítem');
      setTickets(prev => prev.map(t => ({
        ...t,
        items: (t.items || []).map(it => it.item_id === itemId ? { ...it, estado } : it)
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
              <button
                className="kds-btn"
                onClick={(e)=>{ e.stopPropagation(); setEstadoItem(it.item_id, 'preparando'); }}
              >
                Prep
              </button>
            )}
            {it.estado !== 'listo' && (
              <button
                className="kds-btn kds-btn-ghost"
                onClick={(e)=>{ e.stopPropagation(); setEstadoItem(it.item_id, 'listo'); }}
              >
                Listo
              </button>
            )}
          </div>
        </div>

        {Array.isArray(it.acomp) && it.acomp.length > 0 && (
          <ul className="kds-acomp">
            {it.acomp.map((a, idx) => (
              <li key={idx}>{it.cantidad} x {a?.nombre ?? a}</li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  function toggleTheme() {
    setTheme((t) => {
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
          <button className="kds-link" onClick={()=>setDebug(d=>!d)}>
            {debug ? 'Ocultar depuración' : 'Depurar'}
          </button>

          <div className="kds-pager">
            <button className="kds-nav" onClick={()=>{ setAuto(false); setPage(p=>p-1); }}>◀</button>
            <div className="kds-pagechip">{pages===0? '0/0' : `${safePage+1}/${pages}`}</div>
            <button className="kds-nav" onClick={()=>{ setAuto(false); setPage(p=>p+1); }}>▶</button>
          </div>

          <button className="kds-link" onClick={()=>setAuto(a=>!a)}>{auto ? 'Auto ON' : 'Auto OFF'}</button>
          <button className="kds-link" onClick={toggleTheme}>
            Tema: {theme === 'light' ? 'Claro' : 'Oscuro'}
          </button>
        </div>
      </div>

      {error && <div className="toast">{error}</div>}

      <section className="kds-grid">
        {slice.map(t => (
          <article key={t.id} className={`kds-card ${ageClass(t)}`}>
            <div className="kds-card-h">
              <div className="kds-card-h-left">
                <div className="kds-mesa">Mesa {t.mesa_numero}</div>
                <div className="kds-meta">
                  <span>{t.sector}</span>
                  {t.mesero_nombre ? <span>· {t.mesero_nombre}</span> : null}
                  <span>· {t.estado}</span>
                </div>
              </div>
              <div className="kds-timer">{fmtTime(t.edad_seg)}</div>
            </div>

            <div className="kds-items">
              {(t.items || []).map(it => (
                <Item key={it.item_id} it={it} />
              ))}
            </div>

            <div className="kds-card-f">
              <span className="kds-chip">#{t.id}</span>
              <div className="kds-spacer" />
              <span className="kds-pill">{(t.items || []).length} ítem(s)</span>
            </div>
          </article>
        ))}
      </section>

      {debug && (
        <pre className="kds-debug">
{JSON.stringify({ theme, page: safePage+1, pages, size: slice.length, total: tickets.length }, null, 2)}
        </pre>
      )}
    </div>
  );
}
