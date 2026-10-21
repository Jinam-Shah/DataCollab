import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { createFakeSocket } from '../../test/fakeSocket';

const socket = createFakeSocket();
vi.mock('../../services/socket', () => ({ getSocket: () => socket }));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../utils/auth', () => ({ getUser: () => ({ username: 'alice' }) }));

import api from '../../services/api';
import ChatSidebar from './ChatSidebar';

const msg = (id, username, message) => ({ id, username, message, sent_at: '2026-10-20T10:00:00Z' });

it('loads history, sends a message and shows live messages once', async () => {
  api.get.mockResolvedValue({ data: { messages: [msg(1, 'bob', 'morning')] } });
  api.post.mockResolvedValue({ data: {} });
  render(<ChatSidebar />);
  expect(await screen.findByText('morning')).toBeInTheDocument();

  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('Type a message...'), 'hi bob{Enter}');
  expect(api.post).toHaveBeenCalledWith('/api/chat/messages', { message: 'hi bob' });

  act(() => {
    socket.emit('chat:message', msg(2, 'alice', 'hi bob'));
    socket.emit('chat:message', msg(2, 'alice', 'hi bob'));
  });
  expect(screen.getAllByText('hi bob')).toHaveLength(1);
});
