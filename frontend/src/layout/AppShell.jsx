import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { getUser, logout } from '../utils/auth';
import { initSocket, connectSocket, disconnectSocket } from '../services/socket';
import { Icon } from '../components/ui';
import { useToast } from '../components/Toasts';
import ChatSidebar from '../components/Chat/ChatSidebar';

const NAV = [
  {
    to: '/app/data',
    label: 'Data',
    icon: 'database',
    hint: 'Upload CSVs; browse, query and ask about each table',
  },
  {
    to: '/app/ask',
    label: 'Ask AI',
    icon: 'sparkles',
    hint: 'Questions across several tables and documents',
  },
  {
    to: '/app/documents',
    label: 'Documents',
    icon: 'file',
    hint: 'PDFs and notes the AI can read and cite',
  },
  { to: '/app/team', label: 'Team', icon: 'users', hint: 'Invite teammates to this workspace' },
  { to: '/app/history', label: 'Run history', icon: 'history', hint: 'Every AI run, step by step' },
  {
    to: '/app/integrations',
    label: 'Integrations',
    icon: 'plug',
    hint: 'Connect Claude and other AI apps',
  },
];

function NavItems({ onNavigate }) {
  return (
    <nav className="space-y-1">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          title={item.hint}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
              isActive
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`
          }
        >
          <Icon name={item.icon} className="w-5 h-5" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

// Layout for every signed-in page: sidebar navigation, top bar, team chat drawer, and live
// notifications about what teammates do in the same workspace.
function AppShell() {
  const user = getUser();
  const toast = useToast();
  const location = useLocation();
  // Create the socket before any child renders, so children can subscribe in their effects.
  const [socket] = useState(() => initSocket());
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;

  useEffect(() => {
    connectSocket();
    const me = user?.username;
    const onChat = (m) => {
      if (!chatOpenRef.current && m.username !== me) setUnread((n) => n + 1);
    };
    const onUpload = (e) => {
      if (e.username && e.username !== me) toast(`${e.username} uploaded ${e.filename}`);
    };
    const onDoc = (e) => {
      if (e.username && e.username !== me) toast(`${e.username} added the document ${e.filename}`);
    };
    socket.on('chat:message', onChat);
    socket.on('file:uploaded', onUpload);
    socket.on('document:uploaded', onDoc);
    return () => {
      socket.off('chat:message', onChat);
      socket.off('file:uploaded', onUpload);
      socket.off('document:uploaded', onDoc);
      disconnectSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setMobileNav(false), [location.pathname]);

  const openChat = () => {
    setChatOpen(true);
    setUnread(0);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 bg-white border-r border-slate-200 px-3 py-5 sticky top-0 h-screen">
        <div className="px-3 mb-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
              <Icon name="database" className="w-4 h-4" />
            </div>
            <span className="text-lg font-semibold text-slate-900">DataCollab</span>
          </div>
        </div>
        <NavItems />
        <div className="mt-auto px-3 pt-4 border-t border-slate-100 text-xs text-slate-500">
          Workspace
          <div className="text-sm font-medium text-slate-800" data-testid="workspace-name">
            Workspace: {user?.workspaceId || 'default'}
          </div>
        </div>
      </aside>

      {/* Mobile navigation */}
      {mobileNav && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileNav(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white p-4">
            <NavItems onNavigate={() => setMobileNav(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-30">
          <button
            className="lg:hidden text-slate-600"
            onClick={() => setMobileNav(true)}
            aria-label="Open menu"
          >
            <Icon name="menu" />
          </button>
          <div className="hidden lg:block text-sm text-slate-500">
            Signed in as <span className="font-medium text-slate-800">{user?.username}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openChat}
              className="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <Icon name="chat" className="w-5 h-5" />
              Team chat
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                  {unread}
                </span>
              )}
            </button>
            <button
              onClick={logout}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <Icon name="logout" className="w-5 h-5" />
              Log out
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 lg:px-8 py-6 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Team chat drawer. It stays mounted, so messages keep arriving while it is closed. */}
      <div
        className={`fixed inset-y-0 right-0 z-40 w-full sm:w-96 bg-white border-l border-slate-200 shadow-xl transform transition-transform ${
          chatOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!chatOpen}
      >
        <ChatSidebar onClose={() => setChatOpen(false)} visible={chatOpen} />
      </div>
    </div>
  );
}

export default AppShell;
