import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('../../services/socket', () => ({ getSocket: () => null }));
vi.mock('../../services/api', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import api from '../../services/api';
import QueryEditor from './QueryEditor';

const file = { id: 1, tableName: 'sales' };

beforeEach(() => vi.clearAllMocks());

it('asks for a file before anything else', () => {
  render(<QueryEditor selectedFile={null} />);
  expect(screen.getByText(/select a file first/i)).toBeInTheDocument();
});

it('runs a query and pages through results', async () => {
  api.post.mockImplementation((url, body) =>
    Promise.resolve({
      data: {
        success: true,
        data: [{ region: body.page === 1 ? 'north' : 'south', total: 10 }],
        columns: ['region', 'total'],
        rowCount: 1,
        executionTime: 3,
        page: body.page,
        hasMore: body.page === 1,
      },
    })
  );
  render(<QueryEditor selectedFile={file} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'View all data' }));
  expect(screen.getByLabelText('SQL editor')).toHaveValue('SELECT * FROM "sales" LIMIT 100');

  await user.click(screen.getByRole('button', { name: 'Run Query' }));
  expect(await screen.findByText('north')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith(
    '/api/queries/execute',
    expect.objectContaining({ page: 1, pageSize: 100 })
  );

  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('south')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});

it('shows the error from a rejected query', async () => {
  api.post.mockRejectedValue({ response: { data: { error: 'Only SELECT queries are allowed' } } });
  render(<QueryEditor selectedFile={file} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('SQL editor'), 'DELETE FROM sales');
  await user.click(screen.getByRole('button', { name: 'Run Query' }));
  await waitFor(() =>
    expect(screen.getByText(/Only SELECT queries are allowed/)).toBeInTheDocument()
  );
});
