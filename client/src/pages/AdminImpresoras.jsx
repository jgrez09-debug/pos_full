import { useEffect, useState } from "react";
import { api } from "../utils/api";

export default function AdminImpresoras() {
  const [impresoras, setImpresoras] = useState([]);
  const [canales, setCanales] = useState([]);
  const [rutas, setRutas] = useState([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [i, c, r] = await Promise.all([
          api("/api/admin/impresoras"),
          api("/api/admin/canales"),
          api("/api/admin/rutas"),
        ]);
        setImpresoras(i);
        setCanales(c);
        setRutas(r);
      } catch (e) {/* puede que todavía no estén estas rutas; no pasa nada */}
    })();
  }, []);

  async function prueba(canal) {
    try {
      await api("/api/print/test", {
        method: "POST",
        body: { canal, payload: { demo: true, text: "PRUEBA " + canal } },
      });
      setMsg("Trabajo de prueba enviado a " + canal);
    } catch (e) {
      setMsg(e.message || "Error enviando prueba");
    }
  }

  return (
    <div className="m-root">
      <h2>Administrar impresoras</h2>

      <div className="card">
        <div className="card-title">Canales</div>
        <div className="grid">
          {canales.map(c => (
            <button key={c.codigo} className="btn-tile" onClick={() => prueba(c.codigo)}>
              Probar {c.codigo}
            </button>
          ))}
          {canales.length === 0 && <div className="muted">Aún sin API/listado, pero la página ya no rompe.</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Impresoras (demo)</div>
        <ul className="list">
          {impresoras.map(i => (
            <li key={i.id}>
              <div className="row space">
                <span>{i.nombre} · {i.driver}</span>
                <span className="muted">{i.activo ? "activa" : "inactiva"}</span>
              </div>
            </li>
          ))}
          {impresoras.length === 0 && <li className="muted">Sin datos aún.</li>}
        </ul>
      </div>

      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
