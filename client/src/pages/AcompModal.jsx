import React, { useState } from 'react';

export default function AcompModal({ producto, acompDisponibles = [], onConfirm, onClose }) {
  const [cantidad, setCantidad] = useState(1);
  const [seleccionados, setSeleccionados] = useState([]);

  const toggle = (a) => {
    setSeleccionados((prev) =>
      prev.some((x) => x.id === a.id) ? prev.filter((x) => x.id !== a.id) : [...prev, a]
    );
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{marginTop:0}}>{producto?.nombre}</h3>

        <label className="row">
          <span>Cantidad</span>
          <input
            type="number"
            min={1}
            value={cantidad}
            onChange={(e) => setCantidad(Number(e.target.value) || 1)}
          />
        </label>

        <div className="acomp-titulo">Acompañamientos</div>
        <div className="acomp-lista">
          {acompDisponibles.length === 0 && <div className="muted">No hay acompañamientos</div>}
          {acompDisponibles.map((a) => {
            const checked = seleccionados.some((x) => x.id === a.id);
            return (
              <label key={a.id} className="acomp-item">
                <input type="checkbox" checked={checked} onChange={() => toggle(a)} />
                <span className="acomp-nombre">{a.nombre}</span>
                <span className="acomp-precio">
                  {a.precio ? `(+ $${Number(a.precio).toLocaleString()})` : ''}
                </span>
              </label>
            );
          })}
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn" onClick={() => onConfirm({ cantidad, acompIds: seleccionados.map(x => x.id) })}>
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
