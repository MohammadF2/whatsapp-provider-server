import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import Device from '../models/device.model';

// Store active WhatsApp clients in memory (will be restored from database/sessions when needed)
const activeClients: { [deviceId: string]: Client } = {};

// Get the sessions directory path
const getSessionsDir = (): string => {
  return path.resolve(__dirname, '../../sessions');
};

// Check if a session exists for a device
const checkSessionExists = async (deviceId: string): Promise<boolean> => {
  try {
    const sessionsDir = getSessionsDir();
    const deviceSessionDir = path.join(sessionsDir, deviceId);

    // Check if directory exists and has content
    if (fs.existsSync(deviceSessionDir)) {
      const files = fs.readdirSync(deviceSessionDir);
      return files.length > 0;
    }

    return false;
  } catch (error) {
    console.error(`[WhatsApp] Error checking session for device ${deviceId}:`, error);
    return false;
  }
};

// Update session info in database
const updateSessionInfo = async (deviceId: string, connected: boolean = true): Promise<void> => {
  try {
    const sessionExists = await checkSessionExists(deviceId);

    await Device.findByIdAndUpdate(deviceId, {
      sessionInfo: {
        exists: sessionExists,
        lastActive: new Date(),
        ...(connected && { lastReconnect: new Date() })
      }
    });

    console.log(`[WhatsApp] Session info updated for device ${deviceId}, exists: ${sessionExists}`);
  } catch (error) {
    console.error(`[WhatsApp] Error updating session info for device ${deviceId}:`, error);
  }
};

// Initialize WhatsApp client for a device
export const initWhatsAppClient = async (deviceId: string, socketId: string, io: any) => {
  console.log(`[WhatsApp] Initializing client for device ${deviceId}, socket ${socketId}`);
  try {
    // Check if client already exists
    if (activeClients[deviceId]) {
      console.log(`[WhatsApp] Client already exists for device ${deviceId}`);
      return { success: false, message: 'Client already initialized' };
    }

    // Create sessions directory if it doesn't exist
    const sessionsDir = getSessionsDir();
    console.log(`[WhatsApp] Sessions directory: ${sessionsDir}`);
    if (!fs.existsSync(sessionsDir)) {
      console.log(`[WhatsApp] Creating sessions directory: ${sessionsDir}`);
      fs.mkdirSync(sessionsDir, { recursive: true });
    }

    // Check if a session already exists
    const sessionExists = await checkSessionExists(deviceId);
    console.log(`[WhatsApp] Session exists for device ${deviceId}: ${sessionExists}`);

    console.log(`[WhatsApp] Creating new WhatsApp client for device ${deviceId}`);
    // Initialize WhatsApp client with LocalAuth
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: deviceId,
        dataPath: sessionsDir
      }),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
      }
    });

    console.log(`[WhatsApp] Storing client in active clients for device ${deviceId}`);
    // Store client in active clients
    activeClients[deviceId] = client;

    console.log(`[WhatsApp] Updating device status to 'connecting' for device ${deviceId}`);
    // Update device status and session info
    await Device.findByIdAndUpdate(deviceId, {
      status: 'connecting',
      sessionInfo: {
        exists: sessionExists,
        lastActive: new Date()
      }
    });

    console.log(`[WhatsApp] Setting up QR code event handler for device ${deviceId}`);
    // QR code event
    client.on('qr', async (qr) => {
      console.log(`[WhatsApp] QR code received from WhatsApp for device ${deviceId}`);
      try {
        console.log(`[WhatsApp] Generating QR code data URL for device ${deviceId}`);
        // Generate QR code as data URL
        const qrDataURL = await qrcode.toDataURL(qr);

        console.log(`[WhatsApp] Sending QR code to socket ${socketId} for device ${deviceId}`);
        // Send QR code to client
        io.to(socketId).emit('whatsapp:qr', { deviceId, qrCode: qrDataURL });

        console.log(`[WhatsApp] QR code successfully sent for device ${deviceId}`);
      } catch (error) {
        console.error(`[WhatsApp] QR code generation error for device ${deviceId}:`, error);
        io.to(socketId).emit('whatsapp:error', {
          deviceId,
          message: 'Failed to generate QR code'
        });
      }
    });

    // Ready event
    client.on('ready', async () => {
      console.log(`[WhatsApp] Client ready event triggered for device ${deviceId}`);
      try {
        const clientInfo = client.info;
        console.log(`[WhatsApp] Client info received for device ${deviceId}:`, clientInfo);

        const device = await Device.findById(deviceId);
        console.log(`[WhatsApp] Found device in database for device ${deviceId}:`, device ? 'yes' : 'no');

        if (device) {
          console.log(`[WhatsApp] Updating device with WhatsApp info for device ${deviceId}`);
          // Update device with WhatsApp info and session info
          device.status = 'connected';
          device.whatsappInfo = {
            name: clientInfo.pushname,
            number: clientInfo.wid.user,
            profilePicUrl: ''
          };

          // Update session info
          const sessionExists = await checkSessionExists(deviceId);
          device.sessionInfo = {
            exists: sessionExists,
            lastActive: new Date(),
            lastReconnect: new Date()
          };

          await device.save();
          console.log(`[WhatsApp] Device info saved for device ${deviceId}`);

          // Try to get profile picture
          try {
            console.log(`[WhatsApp] Attempting to get profile picture for device ${deviceId}`);
            const profilePicUrl = await client.getProfilePicUrl(clientInfo.wid._serialized);
            if (profilePicUrl) {
              console.log(`[WhatsApp] Profile picture URL obtained for device ${deviceId}`);
              device.whatsappInfo.profilePicUrl = profilePicUrl;
              await device.save();
              console.log(`[WhatsApp] Profile picture URL saved for device ${deviceId}`);
            }
          } catch (picError) {
            console.error(`[WhatsApp] Error getting profile picture for device ${deviceId}:`, picError);
          }

          console.log(`[WhatsApp] Emitting ready event to socket ${socketId} for device ${deviceId}`);
          // Notify client
          io.to(socketId).emit('whatsapp:ready', {
            deviceId,
            info: device.whatsappInfo
          });

          console.log(`[WhatsApp] Client ready process completed for device ${deviceId}`);
        }
      } catch (error) {
        console.error(`[WhatsApp] Ready event error for device ${deviceId}:`, error);
      }
    });

    // Disconnected event
    client.on('disconnected', async () => {
      console.log(`[WhatsApp] Client disconnected event triggered for device ${deviceId}`);
      try {
        console.log(`[WhatsApp] Updating device status to disconnected for device ${deviceId}`);
        // Check if session still exists
        const sessionExists = await checkSessionExists(deviceId);

        await Device.findByIdAndUpdate(deviceId, {
          status: 'disconnected',
          whatsappInfo: undefined,
          sessionInfo: {
            exists: sessionExists,
            lastActive: new Date()
          }
        });

        console.log(`[WhatsApp] Removing client from active clients for device ${deviceId}`);
        // Remove client from active clients
        delete activeClients[deviceId];

        console.log(`[WhatsApp] Emitting disconnected event for device ${deviceId}`);
        // Notify client
        io.emit('whatsapp:disconnected', { deviceId });

        console.log(`[WhatsApp] Client disconnection process completed for device ${deviceId}`);
      } catch (error) {
        console.error(`[WhatsApp] Disconnected event error for device ${deviceId}:`, error);
      }
    });

    // Add authentication failure event
    client.on('auth_failure', (msg) => {
      console.error(`[WhatsApp] Authentication failure for device ${deviceId}:`, msg);
      io.to(socketId).emit('whatsapp:error', {
        deviceId,
        message: 'Authentication failed: ' + msg
      });
    });

    // Add general failure event
    client.on('failure', (error) => {
      console.error(`[WhatsApp] General failure for device ${deviceId}:`, error);
      io.to(socketId).emit('whatsapp:error', {
        deviceId,
        message: 'Connection failed: ' + error.message
      });
    });

    // Add loading screen event for debugging
    client.on('loading_screen', (percent, message) => {
      console.log(`[WhatsApp] Loading screen for device ${deviceId}: ${percent}% - ${message}`);
    });

    console.log(`[WhatsApp] Initializing client for device ${deviceId}`);
    // Initialize client
    await client.initialize();
    console.log(`[WhatsApp] Client initialization completed for device ${deviceId}`);

    return { success: true };
  } catch (error) {
    console.error(`[WhatsApp] Initialize WhatsApp client error for device ${deviceId}:`, error);

    console.log(`[WhatsApp] Updating device status to disconnected after error for device ${deviceId}`);
    // Update device status
    await Device.findByIdAndUpdate(deviceId, { status: 'disconnected' });

    console.log(`[WhatsApp] Cleaning up client after error for device ${deviceId}`);
    // Remove client from active clients if it exists
    if (activeClients[deviceId]) {
      delete activeClients[deviceId];
    }

    return { success: false, message: 'Failed to initialize WhatsApp client: ' + error.message };
  }
};

// Disconnect WhatsApp client
export const disconnectWhatsAppClient = async (deviceId: string) => {
  console.log(`[WhatsApp] Disconnecting client for device ${deviceId}`);
  try {
    const client = activeClients[deviceId];
    if (client) {
      console.log(`[WhatsApp] Client found, destroying for device ${deviceId}`);
      await client.destroy();
      console.log(`[WhatsApp] Client destroyed, removing from active clients for device ${deviceId}`);
      delete activeClients[deviceId];
    } else {
      console.log(`[WhatsApp] No active client found for device ${deviceId}`);
    }

    console.log(`[WhatsApp] Updating device status to disconnected for device ${deviceId}`);

    // Check if session still exists
    const sessionExists = await checkSessionExists(deviceId);

    await Device.findByIdAndUpdate(deviceId, {
      status: 'disconnected',
      whatsappInfo: undefined,
      sessionInfo: {
        exists: sessionExists,
        lastActive: new Date()
      }
    });

    console.log(`[WhatsApp] Disconnect process completed for device ${deviceId}`);
    return { success: true };
  } catch (error) {
    console.error(`[WhatsApp] Disconnect WhatsApp client error for device ${deviceId}:`, error);
    return { success: false, message: 'Failed to disconnect WhatsApp client: ' + error.message };
  }
};

// Send a message
export const sendMessage = async (deviceId: string, to: string, message: string) => {
  console.log(`[WhatsApp] Sending message for device ${deviceId} to ${to}`);
  try {
    // Check for active client
    console.log(`[WhatsApp] Active clients: ${Object.keys(activeClients)}`);
    let client = activeClients[deviceId];

    // If no active client, try to initialize from existing session
    if (!client) {
      console.log(`[WhatsApp] No active client found for device ${deviceId}, checking for existing session`);

      // Check if session directory exists
      const sessionsDir = path.resolve(__dirname, '../../sessions');
      const deviceSessionDir = path.join(sessionsDir, deviceId);

      if (fs.existsSync(deviceSessionDir)) {
        console.log(`[WhatsApp] Found existing session for device ${deviceId}, initializing client`);

        try {
          // Initialize client from existing session
          client = new Client({
            authStrategy: new LocalAuth({
              clientId: deviceId,
              dataPath: sessionsDir
            }),
            puppeteer: {
              args: ['--no-sandbox', '--disable-setuid-sandbox'],
              headless: true
            }
          });

          // Store in active clients
          activeClients[deviceId] = client;

          // Initialize client
          console.log(`[WhatsApp] Initializing client from existing session for device ${deviceId}`);
          await client.initialize();
          console.log(`[WhatsApp] Client initialized from existing session for device ${deviceId}`);

          // Update device status
          await Device.findByIdAndUpdate(deviceId, { status: 'connected' });
        } catch (initError) {
          console.error(`[WhatsApp] Failed to initialize client from existing session for device ${deviceId}:`, initError);
          return {
            success: false,
            message: 'Failed to initialize WhatsApp client from existing session',
            error: initError.message
          };
        }
      } else {
        console.log(`[WhatsApp] No existing session found for device ${deviceId}`);
        return {
          success: false,
          message: 'WhatsApp client not found and no existing session available. Please connect to WhatsApp first.'
        };
      }
    }

    // At this point, we should have a client (either existing or newly initialized)
    if (!client) {
      console.log(`[WhatsApp] Still no client available for device ${deviceId}`);
      return {
        success: false,
        message: 'Failed to get or initialize WhatsApp client'
      };
    }

    // Format number
    const formattedNumber = to.includes('@c.us') ? to : `${to}@c.us`;
    console.log(`[WhatsApp] Formatted number: ${formattedNumber} for device ${deviceId}`);

    // Send message
    console.log(`[WhatsApp] Sending message to ${formattedNumber} for device ${deviceId}`);

    try {
      // Check client state before sending
      const state = await client.getState();
      console.log(`[WhatsApp] Client state before sending: ${state} for device ${deviceId}`);

      if (state !== 'CONNECTED') {
        console.log(`[WhatsApp] Client not in CONNECTED state for device ${deviceId}, attempting to reconnect`);

        // Try to refresh the connection
        try {
          // Force a refresh of the client
          await client.resetState();
          console.log(`[WhatsApp] Client state reset for device ${deviceId}`);

          // Wait a moment for the client to stabilize
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Check state again
          const newState = await client.getState();
          console.log(`[WhatsApp] Client state after reset: ${newState} for device ${deviceId}`);

          if (newState !== 'CONNECTED') {
            return {
              success: false,
              message: `WhatsApp client is not connected. Current state: ${newState}. Please reconnect by scanning the QR code again.`,
              needsReconnect: true
            };
          }
        } catch (resetError) {
          console.error(`[WhatsApp] Error resetting client state for device ${deviceId}:`, resetError);
          return {
            success: false,
            message: 'Failed to reconnect WhatsApp client. Please disconnect and scan the QR code again.',
            needsReconnect: true
          };
        }
      }

      // Now try to send the message
      const response = await client.sendMessage(formattedNumber, message);
      console.log(`[WhatsApp] Message sent successfully for device ${deviceId}, message ID: ${response.id.id}`);

      return { success: true, messageId: response.id.id };
    } catch (sendError) {
      console.error(`[WhatsApp] Error in send operation for device ${deviceId}:`, sendError);

      // Check for WidFactory error specifically
      if (sendError.message && sendError.message.includes('WidFactory')) {
        console.log(`[WhatsApp] WidFactory error detected for device ${deviceId}, session may be invalid`);

        // Update device status and session info
        await Device.findByIdAndUpdate(deviceId, {
          status: 'disconnected',
          sessionInfo: {
            exists: true,  // Session files exist but are invalid
            lastActive: new Date()
          }
        });

        // Remove from active clients
        delete activeClients[deviceId];

        return {
          success: false,
          message: 'WhatsApp session is invalid or expired. Please disconnect and scan the QR code again.',
          error: 'WidFactory error: Session needs to be refreshed',
          needsReconnect: true
        };
      }

      // For other errors, just pass through
      throw sendError;
    }
  } catch (error) {
    console.error(`[WhatsApp] Send message error for device ${deviceId}:`, error);

    // Check for specific errors
    if (error.message && error.message.includes('WidFactory')) {
      // Update device status and session info
      await Device.findByIdAndUpdate(deviceId, {
        status: 'disconnected',
        sessionInfo: {
          exists: true,  // Session files exist but are invalid
          lastActive: new Date()
        }
      });

      // Remove from active clients
      delete activeClients[deviceId];

      return {
        success: false,
        message: 'Failed to send message: WhatsApp session is invalid or expired. Please disconnect and scan the QR code again.',
        error: error.message,
        needsReconnect: true
      };
    }

    // Check for other common WhatsApp Web.js errors
    if (error.message && error.message.includes('Protocol error')) {
      return {
        success: false,
        message: 'Connection to WhatsApp Web failed. Please try again or reconnect the device.',
        error: error.message,
        temporary: true
      };
    }

    if (error.message && error.message.includes('page.evaluate')) {
      return {
        success: false,
        message: 'WhatsApp Web page evaluation failed. The session may be invalid.',
        error: error.message,
        needsReconnect: true
      };
    }

    return {
      success: false,
      message: 'Failed to send message: ' + error.message,
      error: error.stack
    };
  }
};

// Get client by device ID
export const getClient = (deviceId: string) => {
  const client = activeClients[deviceId];
  console.log(`[WhatsApp] Get client for device ${deviceId}: ${client ? 'found' : 'not found'}`);
  return client;
};

// Restore active clients from database on server startup
export const restoreActiveClients = async (): Promise<void> => {
  try {
    console.log('[WhatsApp] Restoring active clients from database');

    // Find all devices with existing sessions
    const devices = await Device.find({
      'sessionInfo.exists': true
    });

    console.log(`[WhatsApp] Found ${devices.length} devices with existing sessions`);

    // Initialize clients for devices with connected status
    const connectedDevices = devices.filter(device => device.status === 'connected');
    console.log(`[WhatsApp] Found ${connectedDevices.length} devices with connected status`);

    for (const device of connectedDevices) {
      try {
        console.log(`[WhatsApp] Restoring client for device ${device._id}`);

        // Initialize client
        const client = new Client({
          authStrategy: new LocalAuth({
            clientId: device._id.toString(),
            dataPath: getSessionsDir()
          }),
          puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
          }
        });

        // Store in active clients
        activeClients[device._id.toString()] = client;

        // Initialize client (don't await to avoid blocking)
        client.initialize().then(() => {
          console.log(`[WhatsApp] Client restored and initialized for device ${device._id}`);
        }).catch(error => {
          console.error(`[WhatsApp] Error initializing restored client for device ${device._id}:`, error);
          delete activeClients[device._id.toString()];

          // Update device status
          Device.findByIdAndUpdate(device._id, {
            status: 'disconnected',
            sessionInfo: {
              exists: true,
              lastActive: new Date()
            }
          }).catch(updateError => {
            console.error(`[WhatsApp] Error updating device status for device ${device._id}:`, updateError);
          });
        });
      } catch (error) {
        console.error(`[WhatsApp] Error restoring client for device ${device._id}:`, error);
      }
    }

    console.log('[WhatsApp] Finished restoring active clients');
  } catch (error) {
    console.error('[WhatsApp] Error restoring active clients:', error);
  }
};

// Test WhatsApp connection by sending a message to self
export const testWhatsAppConnection = async (deviceId: string) => {
  console.log(`[WhatsApp] Testing connection for device ${deviceId}`);
  try {
    // Check for active client
    console.log(`[WhatsApp] Active clients: ${Object.keys(activeClients)}`);
    let client = activeClients[deviceId];

    // If no active client, try to initialize from existing session
    if (!client) {
      console.log(`[WhatsApp] No active client found for device ${deviceId}, checking for existing session`);

      // Check if session directory exists
      const sessionsDir = path.resolve(__dirname, '../../sessions');
      const deviceSessionDir = path.join(sessionsDir, deviceId);

      if (fs.existsSync(deviceSessionDir)) {
        console.log(`[WhatsApp] Found existing session for device ${deviceId}, initializing client`);

        try {
          // Initialize client from existing session
          client = new Client({
            authStrategy: new LocalAuth({
              clientId: deviceId,
              dataPath: sessionsDir
            }),
            puppeteer: {
              args: ['--no-sandbox', '--disable-setuid-sandbox'],
              headless: true
            }
          });

          // Store in active clients
          activeClients[deviceId] = client;

          // Initialize client
          console.log(`[WhatsApp] Initializing client from existing session for device ${deviceId}`);
          await client.initialize();
          console.log(`[WhatsApp] Client initialized from existing session for device ${deviceId}`);

          // Update device status
          await Device.findByIdAndUpdate(deviceId, { status: 'connected' });
        } catch (initError) {
          console.error(`[WhatsApp] Failed to initialize client from existing session for device ${deviceId}:`, initError);
          return {
            success: false,
            message: 'Failed to initialize WhatsApp client from existing session',
            error: initError.message
          };
        }
      } else {
        console.log(`[WhatsApp] No existing session found for device ${deviceId}`);
        return {
          success: false,
          message: 'WhatsApp client not found and no existing session available. Please connect to WhatsApp first.'
        };
      }
    }

    // At this point, we should have a client (either existing or newly initialized)
    if (!client) {
      console.log(`[WhatsApp] Still no client available for device ${deviceId}`);
      return {
        success: false,
        message: 'Failed to get or initialize WhatsApp client'
      };
    }

    // Check client state
    console.log(`[WhatsApp] Checking client state for device ${deviceId}`);
    const clientState = await client.getState();
    console.log(`[WhatsApp] Client state for device ${deviceId}: ${clientState}`);

    if (clientState !== 'CONNECTED') {
      return {
        success: false,
        message: `WhatsApp client is not in CONNECTED state. Current state: ${clientState}`,
        clientState: clientState
      };
    }

    // Check if client info is available
    if (!client.info) {
      console.log(`[WhatsApp] Client info not available for device ${deviceId}`);

      // Try to get client info
      console.log(`[WhatsApp] Attempting to get client info for device ${deviceId}`);
      try {
        // Wait a moment for client to be fully ready
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check if info is available now
        if (!client.info) {
          return {
            success: false,
            message: 'WhatsApp client info not available. The client may not be fully initialized.'
          };
        }
      } catch (infoError) {
        console.error(`[WhatsApp] Error getting client info for device ${deviceId}:`, infoError);
        return {
          success: false,
          message: 'Failed to get WhatsApp client info: ' + infoError.message
        };
      }
    }

    // Get own number safely
    let ownNumber: string;
    try {
      ownNumber = client.info.wid._serialized;
      console.log(`[WhatsApp] Own number: ${ownNumber} for device ${deviceId}`);
    } catch (widError) {
      console.error(`[WhatsApp] Error getting WID for device ${deviceId}:`, widError);
      return {
        success: false,
        message: 'Failed to get WhatsApp ID: ' + widError.message,
        error: 'The WhatsApp client may not be fully authenticated or initialized'
      };
    }

    // Send test message to self
    console.log(`[WhatsApp] Sending test message to self for device ${deviceId}`);
    const testMessage = `Test message from MohammadF Sender. Time: ${new Date().toISOString()}`;

    try {
      // Check client state before sending
      const state = await client.getState();
      console.log(`[WhatsApp] Client state before test: ${state} for device ${deviceId}`);

      if (state !== 'CONNECTED') {
        console.log(`[WhatsApp] Client not in CONNECTED state for device ${deviceId}, attempting to reconnect`);

        // Try to refresh the connection
        try {
          // Force a refresh of the client
          await client.resetState();
          console.log(`[WhatsApp] Client state reset for device ${deviceId}`);

          // Wait a moment for the client to stabilize
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Check state again
          const newState = await client.getState();
          console.log(`[WhatsApp] Client state after reset: ${newState} for device ${deviceId}`);

          if (newState !== 'CONNECTED') {
            return {
              success: false,
              message: `WhatsApp client is not connected. Current state: ${newState}. Please reconnect by scanning the QR code again.`,
              needsReconnect: true
            };
          }
        } catch (resetError) {
          console.error(`[WhatsApp] Error resetting client state for device ${deviceId}:`, resetError);
          return {
            success: false,
            message: 'Failed to reconnect WhatsApp client. Please disconnect and scan the QR code again.',
            needsReconnect: true
          };
        }
      }

      // Now try to send the test message
      const response = await client.sendMessage(ownNumber, testMessage);
      console.log(`[WhatsApp] Test message sent successfully for device ${deviceId}, message ID: ${response.id.id}`);

      return {
        success: true,
        messageId: response.id.id,
        message: 'Test message sent successfully',
        sentTo: ownNumber,
        testMessage: testMessage,
        clientState: state
      };
    } catch (sendError) {
      console.error(`[WhatsApp] Error sending test message for device ${deviceId}:`, sendError);

      // Check if this is a WidFactory error
      if (sendError.message && sendError.message.includes('WidFactory')) {
        // Update device status and session info
        await Device.findByIdAndUpdate(deviceId, {
          status: 'disconnected',
          sessionInfo: {
            exists: true,  // Session files exist but are invalid
            lastActive: new Date()
          }
        });

        // Remove from active clients
        delete activeClients[deviceId];

        return {
          success: false,
          message: 'WhatsApp session is invalid or expired. Please disconnect and scan the QR code again.',
          error: 'WidFactory error: Session needs to be refreshed',
          needsReconnect: true
        };
      }

      // Check for other common WhatsApp Web.js errors
      if (sendError.message && sendError.message.includes('Protocol error')) {
        return {
          success: false,
          message: 'Connection to WhatsApp Web failed. Please try again or reconnect the device.',
          error: sendError.message,
          temporary: true
        };
      }

      if (sendError.message && sendError.message.includes('page.evaluate')) {
        return {
          success: false,
          message: 'WhatsApp Web page evaluation failed. The session may be invalid.',
          error: sendError.message,
          needsReconnect: true
        };
      }

      return {
        success: false,
        message: 'Failed to send test message: ' + sendError.message,
        error: sendError.stack,
        clientState: clientState
      };
    }
  } catch (error) {
    console.error(`[WhatsApp] Test connection error for device ${deviceId}:`, error);
    return {
      success: false,
      message: 'Failed to test WhatsApp connection: ' + error.message,
      error: error.stack
    };
  }
};
