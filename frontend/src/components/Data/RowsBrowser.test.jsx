import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('../../services/api', () => ({ default: { get: vi.fn() } }));

import api from '../../services/api';
import RowsBrowser from './RowsBrowser';

it('pages through every row of a table', async () => {
  api.get.mockImplementation((url) => {
    const page = Number(new URL(url, 'http://x').searchParams.get('page'));
    return Promise.resolve({
      data: { columns: ['n'], rows: [{ n: `row ${page}` }], page, pageSize: 100, total: 250 },
    });
  });
  render(<RowsBrowser fileId={4} />);
  expect(await screen.findByText('row 1')).toBeInTheDocument();
  expect(screen.getByText(/Rows 1–100 of 250/)).toBeInTheDocument();
  expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Last' }));
  expect(await screen.findByText('row 3')).toBeInTheDocument();
  expect(screen.getByText(/Rows 201–250 of 250/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  expect(api.get).toHaveBeenLastCalledWith('/api/files/4/rows?page=3&pageSize=100');
});
