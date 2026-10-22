import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DataPage from './pages/DataPage';
import AskPage from './pages/AskPage';
import DocumentsPage from './pages/DocumentsPage';
import RunHistory from './pages/RunHistory';
import IntegrationsPage from './pages/IntegrationsPage';
import TeamPage from './pages/TeamPage';
import AppShell from './layout/AppShell';
import { ToastProvider } from './components/Toasts';
import { isAuthenticated } from './utils/auth';

function PrivateRoute({ children }) {
  return isAuthenticated() ? children : <Navigate to="/login" replace />;
}

// The SQL editor now lives in each table's "SQL query" tab; old /app/sql links land there.
function LegacySqlRedirect() {
  const [params] = useSearchParams();
  const table = params.get('table');
  const sql = params.get('sql');
  if (!table) return <Navigate to="/app/data" replace />;
  const query = sql ? `?sql=${encodeURIComponent(sql)}` : '';
  return <Navigate to={`/app/data/${table}/sql${query}`} replace />;
}

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/app"
            element={
              <PrivateRoute>
                <AppShell />
              </PrivateRoute>
            }
          >
            <Route index element={<Navigate to="data" replace />} />
            <Route path="data" element={<DataPage />} />
            <Route path="data/:fileId/:tab?" element={<DataPage />} />
            <Route path="sql" element={<LegacySqlRedirect />} />
            <Route path="ask" element={<AskPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="documents/:docId/:tab?" element={<DocumentsPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="history" element={<RunHistory />} />
            <Route path="integrations" element={<IntegrationsPage />} />
          </Route>
          {/* Old addresses from the previous layout. */}
          <Route path="/dashboard" element={<Navigate to="/app/data" replace />} />
          <Route path="/runs" element={<Navigate to="/app/history" replace />} />
          <Route path="*" element={<Navigate to="/app/data" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
