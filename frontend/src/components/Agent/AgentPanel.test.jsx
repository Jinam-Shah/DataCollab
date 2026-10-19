import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { createFakeSocket } from '../../test/fakeSocket';

const socket = createFakeSocket();
vi.mock('../../services/socket', () => ({ getSocket: () => socket }));
vi.mock('../../services/api', () => ({ default: { post: vi.fn() } }));

import api from '../../services/api';
import AgentPanel from './AgentPanel';

it('streams steps, then shows the answer and its SQL', async () => {
  let resolve;
  api.post.mockImplementation(() => new Promise((r) => (resolve = r)));
  const onOpenSql = vi.fn();
  render(<AgentPanel onOpenSql={onOpenSql} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Question'), 'Total by region?');
  await user.click(screen.getByRole('button', { name: 'Ask' }));

  const { requestId } = api.post.mock.calls[0][1];
  act(() => {
    socket.emit('agent:step', { requestId, type: 'get_schema', message: 'Read 1 table schema(s)' });
    socket.emit('agent:step', { requestId: 'someone-else', type: 'plan', message: 'not mine' });
    socket.emit('agent:step', {
      requestId,
      type: 'run_sql',
      message: 'Query failed: bad column',
      error: 'bad column',
    });
    socket.emit('agent:step', { requestId, type: 'write_sql', message: 'Retrying (attempt 2)' });
  });
  expect(screen.getByTestId('agent-steps')).toHaveTextContent(
    'Reading schema: Read 1 table schema(s)'
  );
  expect(screen.getByTestId('agent-steps')).toHaveTextContent('Retrying (attempt 2)');
  expect(screen.queryByText(/not mine/)).not.toBeInTheDocument();

  const sql = 'SELECT region, sum(amount) FROM sales GROUP BY region';
  await act(async () =>
    resolve({
      data: {
        status: 'answered',
        answer: 'North 15, south 20.',
        sql,
        attempts: [{}, {}],
        latencyMs: 40,
        runId: 5,
        rowCount: 2,
      },
    })
  );
  expect(screen.getByTestId('agent-result')).toHaveTextContent('North 15, south 20.');
  expect(screen.getByText(sql)).toBeInTheDocument();
  expect(screen.getByText(/2 attempt\(s\)/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open in editor' }));
  expect(onOpenSql).toHaveBeenCalledWith(sql);
});

it('shows agent errors', async () => {
  api.post.mockRejectedValue({
    response: { data: { error: 'The AI model is not configured on this server' } },
  });
  render(<AgentPanel />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Question'), 'Anything?{Enter}');
  expect(
    await screen.findByText('The AI model is not configured on this server')
  ).toBeInTheDocument();
});
