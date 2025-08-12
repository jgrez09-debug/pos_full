// src/App.jsx
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import RoleRoute from './RoleRoute.jsx';
import Login from './pages/Login.jsx';
import Mesero from './pages/Mesero.jsx';
import Cajero from './pages/Cajero.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<RoleRoute allow={['mesero']} />}>
          <Route path="/mesero" element={<Mesero />} />
        </Route>

        <Route element={<RoleRoute allow={['cajero']} />}>
          <Route path="/cajero" element={<Cajero />} />
        </Route>

        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
