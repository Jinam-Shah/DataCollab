import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { createFakeSocket } from '../../test/fakeSocket';

const socket = createFakeSocket();
vi.mock('../../services/socket', () => ({ getSocket: () => socket }));
vi.mock('../../services/api', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import api from '../../services/api';
import FileUpload from './FileUpload';

const csvFile = (name = 'sales.csv') => new File(['a,b\n1,2\n'], name, { type: 'text/csv' });

beforeEach(() => vi.clearAllMocks());

it('rejects files that are not CSV', async () => {
  render(<FileUpload />);
  // applyAccept: false lets the test bypass the input's accept=".csv" filter.
  const user = userEvent.setup({ applyAccept: false });
  await user.upload(screen.getByLabelText(/browse files/i), new File(['x'], 'notes.txt'));
  expect(screen.getByText('Please upload a CSV file')).toBeInTheDocument();
});

it('uploads a small file and reports it', async () => {
  const onUploadSuccess = vi.fn();
  api.post.mockResolvedValue({ status: 201, data: { file: { id: 7, tableName: 'sales' } } });
  render(<FileUpload onUploadSuccess={onUploadSuccess} />);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText(/browse files/i), csvFile());
  await user.click(screen.getByRole('button', { name: 'Upload' }));
  await waitFor(() => expect(onUploadSuccess).toHaveBeenCalledWith({ id: 7, tableName: 'sales' }));
  expect(api.post.mock.calls[0][0]).toBe('/api/files/upload');
});

it('shows live progress for a background upload and finishes on file:ready', async () => {
  const onUploadSuccess = vi.fn();
  api.post.mockResolvedValue({
    status: 202,
    data: { jobId: '1', file: { id: 9, status: 'queued' } },
  });
  api.get.mockResolvedValue({ data: { file: { id: 9, status: 'ready', rowCount: 50000 } } });
  render(<FileUpload onUploadSuccess={onUploadSuccess} />);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText(/browse files/i), csvFile('big.csv'));
  await user.click(screen.getByRole('button', { name: 'Upload' }));

  await screen.findByTestId('upload-progress');
  act(() =>
    socket.emit('file:progress', {
      fileId: 9,
      phase: 'loading',
      percent: 40,
      rowsLoaded: 20000,
      totalRows: 50000,
    })
  );
  expect(screen.getByText(/20000 \/ 50000 rows/)).toBeInTheDocument();

  // Progress for another file is ignored.
  act(() =>
    socket.emit('file:progress', {
      fileId: 3,
      phase: 'loading',
      percent: 90,
      rowsLoaded: 1,
      totalRows: 2,
    })
  );
  expect(screen.getByText(/20000 \/ 50000 rows/)).toBeInTheDocument();

  await act(async () => socket.emit('file:ready', { fileId: 9 }));
  await waitFor(() =>
    expect(onUploadSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 9, rowCount: 50000 })
    )
  );
  expect(screen.queryByTestId('upload-progress')).not.toBeInTheDocument();
});

it('shows a processing failure', async () => {
  api.post.mockResolvedValue({ status: 202, data: { jobId: '1', file: { id: 11 } } });
  render(<FileUpload />);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText(/browse files/i), csvFile());
  await user.click(screen.getByRole('button', { name: 'Upload' }));
  await screen.findByTestId('upload-progress');
  act(() => socket.emit('file:failed', { fileId: 11, error: 'CSV file is empty' }));
  expect(screen.getByText('Processing failed: CSV file is empty')).toBeInTheDocument();
});
