import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Mesero from "./pages/Mesero.jsx";
import Cajero from "./pages/Cajero.jsx";
import Kds from "./pages/Kds.jsx";
import Login from "./pages/Login.jsx";
import HomeRedirect from "./pages/HomeRedirect.jsx";
import RoleRoute from "./pages/RoleRoute.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Raíz: enruta según rol o a login */}
        <Route path="/" element={<HomeRedirect />} />

        {/* Login */}
        <Route path="/login" element={<Login />} />

        {/* Rutas protegidas por rol */}
        <Route
          path="/mesero"
          element={
            <RoleRoute allow={["mesero", "admin"]}>
              <Mesero />
            </RoleRoute>
          }
        />
        <Route
          path="/cajero"
          element={
            <RoleRoute allow={["cajero", "admin"]}>
              <Cajero />
            </RoleRoute>
          }
        />
        <Route
          path="/kds"
          element={
            <RoleRoute allow={["kds", "cocina", "barra", "admin"]}>
              <Kds />
            </RoleRoute>
          }
        />

        {/* Cualquier otra ruta -> raíz */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
