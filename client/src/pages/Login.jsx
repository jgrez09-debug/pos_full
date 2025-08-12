// src/pages/Login.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../utils/api';

export default function Login() {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const nav = useNavigate();
  const location = useLocation();

  // Si hay sesión previa y NO vienes "expulsado" de una ruta protegida, redirige.
  useEffect(() => {
    const token = localStorage.getItem('token');
    const rawUser = localStorage.getItem('user');
    const cameFromProtected = Boolean(location.state?.from);

    if (!token || !rawUser || cameFromProtected) return;

    let rol = null;
    try { rol = JSON.parse(rawUser)?.rol ?? null; } catch {}

    if (rol === 'mesero') nav('/mesero', { replace: true });
    else if (rol === 'cajero') nav('/cajero', { replace: true });
  }, [nav, location.state]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg(''); setLoading(true);
    try {
      // opcional: limpiar sesión previa para evitar arrastre de rol
      localStorage.removeItem('token');
      localStorage.removeItem('user');

      const { token, user } = await api('/api/login', {
        method: 'POST',
        body: { usuario: usuario.trim(), password }
      });

      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));

      // si venías de una ruta protegida, vuelve ahí
      const from = location.state?.from?.pathname;
      if (from) return nav(from, { replace: true });

      if (user.rol === 'mesero') nav('/mesero', { replace: true });
      else if (user.rol === 'cajero') nav('/cajero', { replace: true });
      else nav('/cajero', { replace: true });
    } catch (err) {
      setMsg(err?.message || 'Error de inicio de sesión');
    } finally {
      setLoading(false);
    }
  };

  const logoutLocal = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setMsg('Sesión limpiada. Ingresa con otro usuario.');
  };

  return (
    <form onSubmit={onSubmit} style={{ padding: 20, maxWidth: 360, margin: '40px auto' }}>
      <h2 style={{ marginBottom: 12 }}>Login</h2>
      <input placeholder="usuario" value={usuario} onChange={e=>setUsuario(e.target.value)}
             autoFocus style={{ display:'block', width:'100%', marginBottom:8, padding:8 }} />
      <input placeholder="contraseña" type="password" value={password}
             onChange={e=>setPassword(e.target.value)}
             style={{ display:'block', width:'100%', marginBottom:12, padding:8 }} />
      <button disabled={loading || !usuario || !password} style={{ padding:'10px 12px', width:'100%' }}>
        {loading ? 'Entrando…' : 'Entrar'}
      </button>
      <button type="button" onClick={logoutLocal}
              style={{ marginTop:8, width:'100%', padding:'8px 12px' }}>
        Cambiar de usuario (limpiar sesión)
      </button>
      {msg && <div style={{ color:'tomato', marginTop:8 }}>{msg}</div>}
    </form>
  );
}
