import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import { getSocket } from '../../services/socket';
import { getUser } from '../../utils/auth';

function ChatSidebar() {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const currentUser = getUser();

  useEffect(() => {
    loadMessages();
    
    const socket = getSocket();
    if (socket) {
      socket.on('chat:message', handleNewMessage);
    }
    
    return () => {
      if (socket) {
        socket.off('chat:message', handleNewMessage);
      }
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    try {
      const response = await api.get('/api/chat/messages?limit=50');
      setMessages(response.data.messages);
    } catch (error) {
      console.error('Load messages error:', error);
    }
  };

  const handleNewMessage = (message) => {
    setMessages(prev => [...prev, message]);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    if (!newMessage.trim() || loading) return;
    
    setLoading(true);
    
    try {
      await api.post('/api/chat/messages', { message: newMessage });
      setNewMessage('');
    } catch (error) {
      console.error('Send message error:', error);
      alert('Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="bg-white rounded-lg shadow h-full flex flex-col">
      <div className="p-4 border-b">
        <h2 className="text-lg font-bold text-gray-900">Team Chat</h2>
        <p className="text-xs text-gray-500">Workspace collaboration</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">
            No messages yet. Start the conversation!
          </div>
        )}
        
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`${
              msg.username === currentUser?.username
                ? 'ml-auto bg-blue-100'
                : 'mr-auto bg-gray-100'
            } max-w-[80%] rounded-lg p-3`}
          >
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-medium text-sm text-gray-900">
                {msg.username}
              </span>
              <span className="text-xs text-gray-500">
                {formatTime(msg.sent_at)}
              </span>
            </div>
            <p className="text-sm text-gray-800 break-words">{msg.message}</p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendMessage} className="p-4 border-t">
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            disabled={loading}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button
            type="submit"
            disabled={loading || !newMessage.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition text-sm font-medium"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

export default ChatSidebar;