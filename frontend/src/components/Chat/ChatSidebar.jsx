import React, { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { getSocket } from '../../services/socket';
import { getUser } from '../../utils/auth';
import { Icon } from '../ui';

const formatTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatDay = (ts) =>
  new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

// Workspace chat. Messages are saved on the server and pushed live to everyone in the workspace.
function ChatSidebar({ onClose, visible = true }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const me = getUser()?.username;

  useEffect(() => {
    api
      .get('/api/chat/messages?limit=100')
      .then((res) => setMessages(res.data.messages))
      .catch(() => setError('Could not load messages'));
    const socket = getSocket();
    if (!socket) return undefined;
    const onMessage = (m) =>
      setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    socket.on('chat:message', onMessage);
    return () => socket.off('chat:message', onMessage);
  }, []);

  useEffect(() => {
    if (visible) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, visible]);

  const send = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await api.post('/api/chat/messages', { message: newMessage });
      setNewMessage('');
    } catch {
      setError('Message not sent. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200">
        <div>
          <h2 className="font-semibold text-slate-900">Team chat</h2>
          <p className="text-xs text-slate-500">Everyone in your workspace sees these messages</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800"
            aria-label="Close chat"
          >
            <Icon name="x" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 text-sm py-10">
            No messages yet. Say hello to your team.
          </div>
        )}
        {messages.map((msg, i) => {
          const mine = msg.username === me;
          const newDay = i === 0 || formatDay(messages[i - 1].sent_at) !== formatDay(msg.sent_at);
          return (
            <React.Fragment key={msg.id}>
              {newDay && (
                <div className="text-center text-xs text-slate-400 py-2">
                  {formatDay(msg.sent_at)}
                </div>
              )}
              <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                {!mine && (
                  <span className="text-xs font-medium text-slate-600 ml-1">{msg.username}</span>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words ${
                    mine
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-slate-100 text-slate-900 rounded-bl-sm'
                  }`}
                >
                  {msg.message}
                </div>
                <span className="text-[11px] text-slate-400 mx-1 mt-0.5">
                  {formatTime(msg.sent_at)}
                </span>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="p-3 border-t border-slate-200">
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            disabled={sending}
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={sending || !newMessage.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-slate-300"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

export default ChatSidebar;
