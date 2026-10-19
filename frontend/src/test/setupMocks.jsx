import { vi } from 'vitest';

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom does not provide.
globalThis.ResizeObserver ||= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Monaco loads from a CDN at runtime; tests use a plain textarea with the same props.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }) => (
    <textarea aria-label="SQL editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
