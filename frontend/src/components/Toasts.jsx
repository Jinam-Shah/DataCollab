import React, { createContext, useCallback, useContext, useState } from 'react';
import { Icon } from './ui';

const ToastContext = createContext(() => {});

export function useToast() {
  return useContext(ToastContext);
}

// Small notifications in the bottom-right corner that disappear after a few seconds.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, kind = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="fixed bottom-4 left-4 lg:left-64 z-50 space-y-2 w-80 max-w-[calc(100vw-2rem)]"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-2 rounded-lg shadow-lg border px-3 py-2 text-sm bg-white ${
              t.kind === 'error' ? 'border-red-200 text-red-800' : 'border-slate-200 text-slate-800'
            }`}
          >
            <Icon
              name={t.kind === 'error' ? 'alert' : 'check'}
              className="w-4 h-4 mt-0.5 shrink-0"
            />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
