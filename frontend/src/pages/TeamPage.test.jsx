import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../utils/auth', () => ({ getUser: () => ({ username: 'alice' }) }));
vi.mock('../components/Toasts', () => ({ useToast: () => vi.fn() }));

import api from '../services/api';
import TeamPage from './TeamPage';

it('shows the invite code and members, and replaces the code', async () => {
  api.get.mockResolvedValue({
    data: {
      workspace: {
        slug: 'team-alpha',
        inviteCode: 'abcDEF123_-x',
        members: [
          { id: 1, username: 'alice', created_at: '2026-10-01T00:00:00Z' },
          { id: 2, username: 'bob', created_at: '2026-10-02T00:00:00Z' },
        ],
      },
    },
  });
  api.post.mockResolvedValue({ data: { inviteCode: 'NEWcode12345' } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<TeamPage />);
  expect(await screen.findByTestId('invite-code')).toHaveTextContent('abcDEF123_-x');
  expect(screen.getByText('team-alpha')).toBeInTheDocument();
  expect(screen.getByTestId('members')).toHaveTextContent('alice (you)');
  expect(screen.getByTestId('members')).toHaveTextContent('bob');

  await userEvent.setup().click(screen.getByRole('button', { name: 'New invite code' }));
  expect(api.post).toHaveBeenCalledWith('/api/workspace/invite-code');
  expect(await screen.findByText('NEWcode12345')).toBeInTheDocument();
});
