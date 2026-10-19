const express = require('express');
const cors = require('cors');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
require('dotenv').config();

// Allowed browser origins. FRONTEND_URL may list several, comma-separated.
function allowedOrigins() {
  const configured = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === 'production') return configured;
  return [...configured, 'http://localhost:3000', 'http://127.0.0.1:3000'];
}

function workspaceRoom(workspaceId) {
  return `workspace:${workspaceId}`;
}

function createApp() {
  const app = express();
  const server = http.createServer(app);
  const corsOptions = { origin: allowedOrigins(), credentials: true };

  const io = new Server(server, { cors: { ...corsOptions, methods: ['GET', 'POST'] } });

  // Sockets must present the same JWT as the REST API; each joins only its workspace's room.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.userId = decoded.userId;
      socket.data.username = decoded.username;
      socket.data.workspaceId = decoded.workspaceId || 'default';
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(workspaceRoom(socket.data.workspaceId));
  });

  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (process.env.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/files', require('./routes/files'));
  app.use('/api/queries', require('./routes/queries'));
  app.use('/api/ai', require('./routes/ai'));
  app.use('/api/chat', require('./routes/chat'));

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      message: 'DataCollab API is running',
      timestamp: new Date().toISOString(),
    });
  });

  app.set('io', io);
  // Emit an event only to sockets in one workspace.
  app.set('broadcast', (workspaceId, event, payload) => {
    io.to(workspaceRoom(workspaceId)).emit(event, payload);
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  app.use((err, req, res, next) => {
    if (err.name === 'MulterError' || err.message === 'Only CSV files are allowed') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app, server, io };
}

module.exports = { createApp, workspaceRoom };
