import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import authRoutes from './routes/auth.routes';
import deviceRoutes from './routes/device.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import conversationRoutes from './routes/conversation.routes';
import messageHistoryRoutes from './routes/message-history.routes';
import contactRoutes from './routes/contact.routes';
import { setupSocketHandlers } from './socket';
import { restoreActiveClients } from './services/whatsapp.service';
import swaggerSpec from './config/swagger';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:4200',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:4200',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    docExpansion: 'none',
    persistAuthorization: true,
  },
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/whatsapp', conversationRoutes); // Add conversation routes under the same prefix
app.use('/api/message-history', messageHistoryRoutes);
app.use('/api/contacts', contactRoutes);

// Socket.io setup
setupSocketHandlers(io);

// Connect to MongoDB (with fallback if MongoDB is not available)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-api-provider';
mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');

    // Restore active WhatsApp clients from database
    try {
      await restoreActiveClients();
    } catch (error) {
      console.error('Error restoring active WhatsApp clients:', error);
    }
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    console.log('Starting server without MongoDB connection...');
  })
  .finally(() => {
    // Start server regardless of MongoDB connection status
    const PORT = process.env.PORT || 3000; // Changed to 3000 to avoid conflicts
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  });

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});
