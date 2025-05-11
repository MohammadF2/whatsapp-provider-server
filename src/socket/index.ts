import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { initWhatsAppClient } from '../services/whatsapp.service';
import User from '../models/user.model';

interface JwtPayload {
  id: string;
}

export const setupSocketHandlers = (io: SocketIOServer) => {
  console.log('[Socket] Setting up socket handlers');

  // Authentication middleware
  io.use(async (socket, next) => {
    console.log(`[Socket] New connection attempt: ${socket.id}`);
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        console.log(`[Socket] Authentication failed - no token provided: ${socket.id}`);
        return next(new Error('Authentication error: Token not provided'));
      }
      console.log(`[Socket] Token received, verifying: ${socket.id}`);

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret') as JwtPayload;
      console.log(`[Socket] Token verified, user ID: ${decoded.id}, socket: ${socket.id}`);

      // Find user by id
      const user = await User.findById(decoded.id);
      if (!user) {
        console.log(`[Socket] User not found for ID: ${decoded.id}, socket: ${socket.id}`);
        return next(new Error('Authentication error: User not found'));
      }
      console.log(`[Socket] User found: ${user.name}, socket: ${socket.id}`);

      // Set user in socket
      socket.data.user = user;
      console.log(`[Socket] Authentication successful for user: ${user.name}, socket: ${socket.id}`);
      next();
    } catch (error) {
      console.error(`[Socket] Authentication error for socket ${socket.id}:`, error);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    console.log(`[Socket] Socket connected: ${socket.id}, user: ${socket.data.user.name}`);

    // Initialize WhatsApp client
    socket.on('whatsapp:init', async ({ deviceId }) => {
      console.log(`[Socket] WhatsApp init request received for device ${deviceId}, socket: ${socket.id}`);
      try {
        // Check if user owns the device
        const userId = socket.data.user._id;
        console.log(`[Socket] User ID from socket: ${userId}, socket: ${socket.id}`);

        console.log(`[Socket] Initializing WhatsApp client for device ${deviceId}, socket: ${socket.id}`);
        // Initialize WhatsApp client
        const result = await initWhatsAppClient(deviceId, socket.id, io);
        console.log(`[Socket] WhatsApp client initialization result for device ${deviceId}: ${result.success ? 'success' : 'failed'}`);

        if (!result.success) {
          console.log(`[Socket] Emitting error for failed initialization, device ${deviceId}, socket: ${socket.id}`);
          socket.emit('whatsapp:error', {
            deviceId,
            message: result.message
          });
        }
      } catch (error) {
        console.error(`[Socket] WhatsApp init error for device ${deviceId}, socket: ${socket.id}:`, error);
        socket.emit('whatsapp:error', {
          deviceId,
          message: 'Failed to initialize WhatsApp client: ' + (error.message || 'Unknown error')
        });
      }
    });

    // Debug event to check if socket is working
    socket.on('ping', (data) => {
      console.log(`[Socket] Ping received from socket ${socket.id}, data:`, data);
      socket.emit('pong', { message: 'Pong!', receivedData: data, timestamp: new Date().toISOString() });
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Socket disconnected: ${socket.id}`);
    });
  });

  console.log('[Socket] Socket handlers setup complete');
};
