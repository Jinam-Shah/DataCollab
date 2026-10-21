import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../services/socket', () => ({ getSocket: () => null }));
vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../components/Toasts', () => ({ useToast: () => vi.fn() }));

import api from '../services/api';
import DocumentsPage from './DocumentsPage';

const doc = {
  id: 3,
  filename: 'dictionary.md',
  file_size: 900,
  page_count: null,
  chunk_count: 2,
  username: 'alice',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) =>
    Promise.resolve(
      url === '/api/documents'
        ? { data: { documents: [doc] } }
        : {
            data: {
              document: doc,
              chunks: [
                {
                  id: 10,
                  chunk_index: 0,
                  page: null,
                  section: 'Columns',
                  content: 'region is the sales territory',
                },
                {
                  id: 11,
                  chunk_index: 1,
                  page: null,
                  section: 'Caveats',
                  content: 'All causes is a total',
                },
              ],
            },
          }
    )
  );
});

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/documents" element={<DocumentsPage />} />
        <Route path="/app/documents/:docId" element={<DocumentsPage />} />
      </Routes>
    </MemoryRouter>
  );

it('lists documents and opens one to show its passages', async () => {
  renderAt('/app/documents');
  expect(screen.getByText(/Documents are not tables/)).toBeInTheDocument();
  await userEvent.setup().click(await screen.findByRole('button', { name: /dictionary\.md/ }));
  expect(await screen.findByText('region is the sales territory')).toBeInTheDocument();
  expect(screen.getByText('All causes is a total')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/api/documents/3');
});

it('opens the uploaded document after an upload', async () => {
  api.post.mockResolvedValue({ data: { document: { id: 3 } } });
  renderAt('/app/documents');
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText(/upload document/i), new File(['# hi'], 'dictionary.md'));
  expect(api.post.mock.calls[0][0]).toBe('/api/documents');
  expect(await screen.findByTestId('document-viewer')).toHaveTextContent('2 passages');
});
