import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

let socket = null;

export const initSocket = () => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: false,
      // The server only accepts sockets with a valid JWT and joins them to their workspace room.
      auth: (cb) => cb({ token: localStorage.getItem('token') }),
    });
  }
  return socket;
};

export const connectSocket = () => {
  if (socket && !socket.connected) {
    socket.connect();
  }
};

export const disconnectSocket = () => {
  if (socket && socket.connected) {
    socket.disconnect();
  }
};

export const getSocket = () => {
  return socket;
};

export default {
  initSocket,
  connectSocket,
  disconnectSocket,
  getSocket,
};
