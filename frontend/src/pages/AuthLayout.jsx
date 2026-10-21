import React from 'react';
import { Icon } from '../components/ui';

const FEATURES = [
  ['database', 'Upload CSVs and get a data quality report'],
  ['code', 'Query them with safe, read-only SQL'],
  ['sparkles', 'Ask questions in plain English'],
  ['chat', 'Work together live with your team'],
];

export const inputClass =
  'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50';
export const labelClass = 'block text-sm font-medium text-slate-700 mb-1';

// Shared frame for the sign-in and sign-up pages.
function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50">
      <div className="hidden lg:flex flex-col justify-center px-16 bg-indigo-700 text-white">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center">
            <Icon name="database" className="w-5 h-5" />
          </div>
          <span className="text-xl font-semibold">DataCollab</span>
        </div>
        <h2 className="text-3xl font-semibold leading-tight mb-6">
          Your team&apos;s data, one question away.
        </h2>
        <ul className="space-y-3 text-indigo-100">
          {FEATURES.map(([icon, text]) => (
            <li key={text} className="flex items-center gap-3">
              <Icon name={icon} className="w-5 h-5 text-indigo-200" />
              {text}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500 mt-1 mb-6">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export default AuthLayout;
