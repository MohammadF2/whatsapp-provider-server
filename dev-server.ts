import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';
import http from 'http';
import authRoutes from './src/routes/auth.routes';
import deviceRoutes from './src/routes/device.routes';
import whatsappRoutes from './src/routes/whatsapp.routes';
import { setupSocketHandlers } from './src/socket';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const server = http.createServer(app);

// Setup Socket.io
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:4200',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Setup socket handlers
setupSocketHandlers(io);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Connect to MongoDB (with fallback if MongoDB is not available)
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-api-provider';
mongoose.connect(mongoURI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    console.log('Starting server without MongoDB connection...');
  });

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
