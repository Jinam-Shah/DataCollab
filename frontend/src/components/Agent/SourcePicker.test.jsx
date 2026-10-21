import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('../../services/socket', () => ({ getSocket: () => null }));
vi.mock('../../services/api', () => ({ default: { post: vi.fn() } }));

import api from '../../services/api';
import SourcePicker from './SourcePicker';
import AgentPanel from './AgentPanel';

const files = [
  { id: 1, original_filename: 'sales.csv', status: 'ready' },
  { id: 2, original_filename: 'costs.csv', status: 'ready' },
];
const documents = [{ id: 7, filename: 'dictionary.md' }];

function Harness({ locked }) {
  const [scope, setScope] = useState({ fileIds: [1, 2], documentIds: [7] });
  return (
    <>
      <SourcePicker
        files={files}
        documents={documents}
        value={scope}
        onChange={setScope}
        lockedFileId={locked}
      />
      <AgentPanel scope={scope} />
    </>
  );
}

it('sends only the selected tables and documents to the agent', async () => {
  api.post.mockResolvedValue({ data: { status: 'answered', answer: 'ok', attempts: [] } });
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'costs.csv' }));
  expect(screen.getByRole('button', { name: 'costs.csv' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await user.type(screen.getByLabelText('Question'), 'Total?{Enter}');
  expect(api.post).toHaveBeenCalledWith(
    '/api/agent/ask',
    expect.objectContaining({ fileIds: [1], documentIds: [7] })
  );
});

it('blocks asking when nothing is selected, and keeps a locked table', async () => {
  render(<Harness locked={1} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Clear all' }));
  expect(screen.getByRole('button', { name: 'sales.csv' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'sales.csv' })).toBeDisabled();
  expect(screen.getByText(/1 table\(s\), 0 document\(s\) selected/)).toBeInTheDocument();
});

it('disables the question box when nothing is selected', async () => {
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Clear all' }));
  expect(screen.getByLabelText('Question')).toBeDisabled();
});
