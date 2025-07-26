import { Client, LocalAuth } from 'whatsapp-web.js';
import seleniumDriverManager from './selenium.service';
import Device from '../models/device.model';
import WhatsAppClient from '../models/whatsapp-client.model';
import { WebDriver } from 'selenium-webdriver';
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import CustomBrowserLauncher from './custom-browser-launcher';

// Get sessions directory path
const getSessionsDir = () => {
  const sessionsDir = path.resolve(__dirname, '../../sessions');
  return sessionsDir;
};

// Check if a session exists for a device ID
const checkSessionExists = (deviceId: string): boolean => {
  const sessionsDir = getSessionsDir();
  const deviceSessionDir = path.join(sessionsDir, deviceId);
  
  return fs.existsSync(deviceSessionDir) && 
         fs.readdirSync(deviceSessionDir).length > 0;
};

/**
 * SeleniumWhatsAppManager - A class to manage WhatsApp client instances with Selenium WebDriver
 *
 * This class provides methods to:
 * - Initialize WhatsApp Web client with Selenium
 * - Maintain device sessions and status
 * - Connect, disconnect, and reconnect WhatsApp instances
 */
class SeleniumWhatsAppManager {
  // Private storage for active client instances (in-memory cache)
  private clients: { [deviceId: string]: Client } = {};

  // Private storage for Selenium drivers (in-memory cache)
  private drivers: { [deviceId: string]: WebDriver } = {};

  // Private storage for client metadata (in-memory cache)
  private metadata: {
    [deviceId: string]: {
      lastActive: Date;
      status: 'disconnected' | 'connecting' | 'connected';
      initialized: boolean;
    }
  } = {};

  /**
   * Initialize a WhatsApp client with Selenium WebDriver for a device
   * @param deviceId The device ID
   * @returns Object with success status and result information
   */
  async initializeClient(deviceId: string, socketId: string, io: any): Promise<any> {
    console.log(`[SeleniumWhatsAppManager] Initializing WhatsApp client for device ${deviceId}`);
    
    try {
      // Check if client already exists
      if (this.clients[deviceId]) {
        console.log(`[SeleniumWhatsAppManager] Client already exists for device ${deviceId}`);
        return { success: false, message: 'Client already initialized' };
      }

      // Get device configuration
      const device = await Device.findById(deviceId);
      if (!device) {
        throw new Error(`Device not found: ${deviceId}`);
      }

      // Check if we should use Selenium
      if (!device.seleniumConfig) {
        console.log(`[SeleniumWhatsAppManager] Device ${deviceId} has no Selenium configuration, using default WhatsApp Web.js`);
        // Fallback to existing WhatsApp Web.js implementation
        return this.initializeDefaultClient(deviceId, socketId, io);
      }      console.log(`[SeleniumWhatsAppManager] Using Selenium for device ${deviceId}`);
      const { browserType, headless, userAgent, autoConnect } = device.seleniumConfig;      // Initialize Selenium WebDriver
      const driver = await seleniumDriverManager.createDriver(
        deviceId, 
        browserType, 
        {
          headless: headless === true,  // Convert to boolean explicitly for type safety
          userAgent,
          extraArgs: ['--disable-notifications']
        }
      );

      // Store driver reference
      this.drivers[deviceId] = driver;

      // Create sessions directory if it doesn't exist
      const sessionsDir = getSessionsDir();
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
      }      // Initialize WhatsApp Web client with Selenium
      // whatsapp-web.js expects a Puppeteer-compatible browser instance
      // We'll use a custom puppeteer configuration that provides the Selenium WebDriver
      const puppeteerConfig: any = {
        // We need to create a browser instance that wraps the Selenium driver
        // The property should be browserWSEndpoint for remote browser connections
        executablePath: 'selenium',  // This is just a marker, not actually used
        browserWSEndpoint: 'selenium-custom-driver', // Signal to use custom driver
        
        // Standard Puppeteer properties
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
        headless: device.seleniumConfig?.headless === true,
        
        // Add a custom property to pass the Selenium driver instance
        // This will be used by the custom browser implementation
        selenium: {
          driver: driver
        },
        
        // Extended timeout settings
        timeout: 120000 // 120 seconds timeout (increased from 60)
      };      // Override the native puppeteer launcher with our custom launcher
      // This needs to be done before creating the client
      const originalPuppeteer = require('puppeteer');
      const customLauncher = {
        launch: async (options: any) => {
          console.log(`[SeleniumWhatsAppManager] Launching browser with options:`, 
                      JSON.stringify({
                        headless: options.headless,
                        executablePath: options.executablePath,
                        browserWSEndpoint: options.browserWSEndpoint,
                      }));
          
          try {
            // Try our custom launcher first
            const customBrowser = await CustomBrowserLauncher.launch(options);
            
            // If our custom launcher returns null, use the original puppeteer
            if (customBrowser === null) {
              console.log(`[SeleniumWhatsAppManager] Using original Puppeteer`);
              return originalPuppeteer.launch(options);
            }
            
            console.log(`[SeleniumWhatsAppManager] Using custom browser launcher`);
            return customBrowser;
          } catch (error) {
            console.error(`[SeleniumWhatsAppManager] Error in browser launch:`, error);
            throw error;
          }
        }
      };
      
      // Create the WhatsApp Web client with our custom browser launcher
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: deviceId,
          dataPath: sessionsDir
        }),
        puppeteer: {
          ...puppeteerConfig,
          // Provide a mock browser launcher that will be used by whatsapp-web.js
          _launcher: customLauncher
        },
        // Add additional client options for better stability
        qrMaxRetries: 5,
        authTimeoutMs: 120000, // Increased from 60000
        takeoverOnConflict: true,
        takeoverTimeoutMs: 180000, // Increased from 120000
        // Add more client options for better stability
        restartOnAuthFail: true,
        userAgent: device.seleniumConfig?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      });

      // Store client in memory
      this.clients[deviceId] = client;
      this.metadata[deviceId] = {
        lastActive: new Date(),
        status: 'connecting',
        initialized: false
      };

      // Update device in database
      await Device.findByIdAndUpdate(deviceId, {
        status: 'connecting',
        'seleniumConfig.lastDriverInitialization': new Date(),
        sessionInfo: {
          exists: checkSessionExists(deviceId),
          lastActive: new Date(),
        }
      });

      // Also update or create WhatsAppClient record
      await WhatsAppClient.findOneAndUpdate(
        { deviceId },
        {
          status: 'connecting',
          lastActive: new Date(),
          sessionExists: checkSessionExists(deviceId)
        },
        { upsert: true }
      );

      // Set up event handlers
      this.setupEventHandlers(client, deviceId, socketId, io);

      // Initialize the client
      console.log(`[SeleniumWhatsAppManager] Starting WhatsApp client for device ${deviceId}`);
      await client.initialize();

      return { success: true };
    } catch (error) {
      console.error(`[SeleniumWhatsAppManager] Error initializing client:`, error);

      // Clean up if initialization failed
      await this.cleanupClient(deviceId);
      
      return { 
        success: false, 
        message: 'Failed to initialize WhatsApp client',
        error: error.message
      };
    }
  }

  /**
   * Initialize a WhatsApp client using the default implementation without Selenium
   * @param deviceId The device ID
   * @returns Object with success status and result information
   */
  private async initializeDefaultClient(deviceId: string, socketId: string, io: any): Promise<any> {
    console.log(`[SeleniumWhatsAppManager] Initializing default WhatsApp client for device ${deviceId}`);
    
    try {
      // Create sessions directory if it doesn't exist
      const sessionsDir = getSessionsDir();
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
      }

      // Initialize WhatsApp Web client with Puppeteer
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

      // Store client in memory
      this.clients[deviceId] = client;
      this.metadata[deviceId] = {
        lastActive: new Date(),
        status: 'connecting',
        initialized: false
      };

      // Update device in database
      await Device.findByIdAndUpdate(deviceId, {
        status: 'connecting',
        sessionInfo: {
          exists: checkSessionExists(deviceId),
          lastActive: new Date(),
        }
      });

      // Also update or create WhatsAppClient record
      await WhatsAppClient.findOneAndUpdate(
        { deviceId },
        {
          status: 'connecting',
          lastActive: new Date(),
          sessionExists: checkSessionExists(deviceId)
        },
        { upsert: true }
      );

      // Set up event handlers
      this.setupEventHandlers(client, deviceId, socketId, io);

      // Initialize the client
      console.log(`[SeleniumWhatsAppManager] Starting default WhatsApp client for device ${deviceId}`);
      await client.initialize();

      return { success: true };
    } catch (error) {
      console.error(`[SeleniumWhatsAppManager] Error initializing default client:`, error);

      // Clean up if initialization failed
      await this.cleanupClient(deviceId);
      
      return { 
        success: false, 
        message: 'Failed to initialize WhatsApp client',
        error: error.message
      };
    }
  }

  /**
   * Set up event handlers for the WhatsApp client
   * @param client The WhatsApp client
   * @param deviceId The device ID
   */
  private setupEventHandlers(client: Client, deviceId: string, socketId: string, io: any): void {
    // Handle QR code generation
    client.on('qr', async (qr) => {
      console.log(`[SeleniumWhatsAppManager] QR code received for device ${deviceId}`);
      
      try {
        // Generate QR code as data URL
        const qrDataUrl = await qrcode.toDataURL(qr);
        
        // Emit QR code to socket
        if (socketId && io) {
          io.to(socketId).emit('qr', { deviceId, qrDataUrl });
        }
        
        // Also broadcast to all sockets for this device
        io.to(`device:${deviceId}`).emit('qr', { deviceId, qrDataUrl });
        
        // Update device with current status
        await Device.findByIdAndUpdate(deviceId, {
          status: 'connecting'
        });
      } catch (error) {
        console.error(`[SeleniumWhatsAppManager] Error handling QR code for device ${deviceId}:`, error);
      }
    });

    // Handle ready state
    client.on('ready', async () => {
      console.log(`[SeleniumWhatsAppManager] WhatsApp client ready for device ${deviceId}`);
      
      // Update metadata
      if (this.metadata[deviceId]) {
        this.metadata[deviceId].status = 'connected';
        this.metadata[deviceId].initialized = true;
        this.metadata[deviceId].lastActive = new Date();
      }
        try {
        // TypeScript doesn't recognize getInfo() method, but it's available at runtime in newer versions
        // Use type assertion to access it
        const info = await (client as any).getInfo();
        
        // Update device with info and status
        await Device.findByIdAndUpdate(deviceId, {
          status: 'connected',
          whatsappInfo: {
            name: info?.pushname,
            number: info?.wid?.user,
            profilePicUrl: await client.getProfilePicUrl(info?.wid?._serialized)
          },
          sessionInfo: {
            exists: true,
            lastActive: new Date(),
            lastReconnect: new Date()
          }
        });
        
        // Update WhatsAppClient record
        await WhatsAppClient.findOneAndUpdate(
          { deviceId },
          {
            status: 'connected',
            lastActive: new Date(),
            lastReconnect: new Date(),
            sessionExists: true,
            metadata: {
              name: info?.pushname,
              number: info?.wid?.user,
              wid: info?.wid?._serialized,
              platform: info?.platform
            }
          },
          { upsert: true }
        );
        
        // Notify sockets
        if (socketId && io) {
          io.to(socketId).emit('ready', { 
            deviceId, 
            info: {
              name: info?.pushname,
              number: info?.wid?.user
            }
          });
        }
        
        // Also broadcast to all sockets for this device
        io.to(`device:${deviceId}`).emit('ready', { 
          deviceId, 
          info: {
            name: info?.pushname,
            number: info?.wid?.user
          }
        });
      } catch (error) {
        console.error(`[SeleniumWhatsAppManager] Error handling ready event for device ${deviceId}:`, error);
      }
    });

    // Handle disconnected state
    client.on('disconnected', async (reason) => {
      console.log(`[SeleniumWhatsAppManager] WhatsApp client disconnected for device ${deviceId}. Reason: ${reason}`);
      
      // Clean up client
      await this.cleanupClient(deviceId);
      
      // Notify sockets
      if (socketId && io) {
        io.to(socketId).emit('disconnected', { deviceId, reason });
      }
      
      // Also broadcast to all sockets for this device
      io.to(`device:${deviceId}`).emit('disconnected', { deviceId, reason });
    });

    // Handle authentication failure
    client.on('auth_failure', async (msg) => {
      console.error(`[SeleniumWhatsAppManager] Authentication failure for device ${deviceId}: ${msg}`);
      
      // Clean up client
      await this.cleanupClient(deviceId);
      
      // Notify sockets
      if (socketId && io) {
        io.to(socketId).emit('auth_failure', { deviceId, msg });
      }
      
      // Also broadcast to all sockets for this device
      io.to(`device:${deviceId}`).emit('auth_failure', { deviceId, msg });
    });
  }

  /**
   * Clean up client and driver resources
   * @param deviceId The device ID
   */  async cleanupClient(deviceId: string): Promise<void> {
    console.log(`[SeleniumWhatsAppManager] Cleaning up resources for device ${deviceId}`);
    
    // Step 1: Close WhatsApp client if it exists
    if (this.clients[deviceId]) {
      try {
        const client = this.clients[deviceId];
        
        // Safely destroy the client with comprehensive null checking
        if (client && typeof client.destroy === 'function') {
          console.log(`[SeleniumWhatsAppManager] Destroying WhatsApp client for device ${deviceId}`);
          
          // Patch the client to prevent "Cannot read properties of null" error
          // This makes the destroy method safer by checking for pupBrowser before accessing it
          try {
            // Access the internal browser property safely
            const pupBrowser = (client as any).pupBrowser;
            
            if (!pupBrowser) {
              console.log(`[SeleniumWhatsAppManager] Client for device ${deviceId} has no browser to close, skipping browser.close()`);
              
              // If there's no browser, we still need to clean up auth strategy
              if ((client as any).authStrategy && typeof (client as any).authStrategy.destroy === 'function') {
                await (client as any).authStrategy.destroy();
              }
            } else {
              // Normal destroy with browser closing
              await client.destroy();
              console.log(`[SeleniumWhatsAppManager] Successfully destroyed WhatsApp client for device ${deviceId}`);
            }
          } catch (destroyError) {
            console.warn(`[SeleniumWhatsAppManager] Error in destroy process for device ${deviceId}:`, destroyError);
          }
        } else {
          console.log(`[SeleniumWhatsAppManager] Client for device ${deviceId} doesn't have a valid destroy method`);
        }
      } catch (error) {
        console.warn(`[SeleniumWhatsAppManager] Error destroying WhatsApp client for device ${deviceId}:`, error);
      } finally {
        // Always remove from cache regardless of errors
        console.log(`[SeleniumWhatsAppManager] Removing client from cache for device ${deviceId}`);
        delete this.clients[deviceId];
        delete this.metadata[deviceId];
      }
    } else {
      console.log(`[SeleniumWhatsAppManager] No client found for device ${deviceId}`);
    }
    
    // Step 2: Close Selenium driver if it exists (with delay to ensure proper cleanup)
    if (this.drivers[deviceId]) {
      try {
        console.log(`[SeleniumWhatsAppManager] Closing WebDriver for device ${deviceId}`);
        
        // Add a small delay before closing the driver to allow other cleanup to finish
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Close the driver
        await seleniumDriverManager.closeDriver(deviceId);
        console.log(`[SeleniumWhatsAppManager] Successfully closed WebDriver for device ${deviceId}`);
      } catch (error) {
        console.warn(`[SeleniumWhatsAppManager] Error closing WebDriver for device ${deviceId}:`, error);
      } finally {
        // Always remove from cache regardless of errors
        delete this.drivers[deviceId];
      }
    } else {
      console.log(`[SeleniumWhatsAppManager] No WebDriver found for device ${deviceId}`);
    }
    
    // Update device status in database
    try {
      await Device.findByIdAndUpdate(deviceId, {
        status: 'disconnected'
      });
      
      // Update WhatsAppClient record
      await WhatsAppClient.findOneAndUpdate(
        { deviceId },
        {
          status: 'disconnected',
          lastActive: new Date()
        }
      );
    } catch (error) {
      console.error(`[SeleniumWhatsAppManager] Error updating device status:`, error);
    }
  }

  /**
   * Get a client by device ID - checks both Selenium clients and regular WhatsApp clients
   * @param deviceId The device ID
   * @returns The WhatsApp client instance or undefined
   */
  async getClient(deviceId: string): Promise<Client | undefined> {
    // First check Selenium clients (this manager's own clients)
    if (this.clients[deviceId] && this.metadata[deviceId]) {
      this.metadata[deviceId].lastActive = new Date();

      // Update database with last active time
      try {
        await Device.findByIdAndUpdate(deviceId, {
          'sessionInfo.lastActive': new Date()
        });

        await WhatsAppClient.findOneAndUpdate(
          { deviceId },
          { lastActive: new Date() }
        );
      } catch (error) {
        console.warn(`[SeleniumWhatsAppManager] Error updating last active time:`, error);
      }

      console.log(`[SeleniumWhatsAppManager] Found Selenium client for device ${deviceId}`);
      return this.clients[deviceId];
    }

    // If no Selenium client found, check the regular WhatsApp client manager
    // This handles cases where QR code authentication created a regular client
    // but the device is configured to use Selenium
    console.log(`[SeleniumWhatsAppManager] No Selenium client found for device ${deviceId}, checking regular WhatsApp client manager`);

    try {
      // Import the regular WhatsApp client manager
      const { activeClients } = require('./whatsapp.service');

      // Check if there's a regular WhatsApp client for this device
      const regularClient = await activeClients.getClient(deviceId);

      if (regularClient) {
        console.log(`[SeleniumWhatsAppManager] Found regular WhatsApp client for device ${deviceId}, using it for Selenium operations`);

        // Store it in our Selenium manager for future use
        this.clients[deviceId] = regularClient;
        this.metadata[deviceId] = {
          lastActive: new Date(),
          status: 'connected',
          initialized: true
        };

        return regularClient;
      }
    } catch (error) {
      console.error(`[SeleniumWhatsAppManager] Error checking regular WhatsApp client manager:`, error);
    }

    console.log(`[SeleniumWhatsAppManager] No client found for device ${deviceId} in either Selenium or regular managers`);
    return undefined;
  }

  /**
   * Check if a client exists for a device
   * @param deviceId The device ID
   * @returns True if client exists and is connected
   */
  hasClient(deviceId: string): boolean {
    return !!this.clients[deviceId] && 
           this.metadata[deviceId]?.status === 'connected';
  }

  /**
   * Disconnect a client and clean up resources
   * @param deviceId The device ID
   */
  async disconnectClient(deviceId: string): Promise<{ success: boolean, message?: string }> {
    console.log(`[SeleniumWhatsAppManager] Disconnecting client for device ${deviceId}`);
    
    if (!this.clients[deviceId]) {
      return { success: false, message: 'Client not found' };
    }
    
    try {
      // Clean up client resources
      await this.cleanupClient(deviceId);
      return { success: true };
    } catch (error) {
      console.error(`[SeleniumWhatsAppManager] Error disconnecting client:`, error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Send a message using the WhatsApp client
   * @param deviceId The device ID
   * @param to The recipient phone number
   * @param message The message to send
   */
  async sendMessage(deviceId: string, to: string, message: string): Promise<any> {
    console.log(`[SeleniumWhatsAppManager] Sending message from device ${deviceId} to ${to}`);
    
    // Get the client
    const client = await this.getClient(deviceId);
    
    if (!client) {
      return { 
        success: false, 
        message: 'Client not found or not connected',
        needsReconnect: true
      };
    }
    
    try {
      // Ensure number is formatted correctly
      const formattedNumber = to.includes('@c.us') ? to : `${to}@c.us`;
      
      // Send message
      const result = await client.sendMessage(formattedNumber, message);
      
      return {
        success: true,
        messageId: result.id._serialized
      };
    } catch (error) {
      console.error(`[SeleniumWhatsAppManager] Error sending message:`, error);
      
      // Check if client needs to be reconnected
      if (error.message.includes('not authorized') || 
          error.message.includes('session expired') ||
          error.message.includes('browser session closed')) {
        
        // Clean up client resources
        await this.cleanupClient(deviceId);
        
        return {
          success: false,
          message: 'WhatsApp session expired, please reconnect',
          needsReconnect: true
        };
      }
      
      return {
        success: false,
        message: error.message,
        error: error.stack,
        temporary: !error.message.includes('not connected')
      };
    }
  }
}

// Create singleton instance
const seleniumWhatsAppManager = new SeleniumWhatsAppManager();
export default seleniumWhatsAppManager;

// Export public functions that match the existing whatsapp.service.ts interface
export const initWhatsAppClientWithSelenium = async (deviceId: string, socketId: string, io: any) => {
  return seleniumWhatsAppManager.initializeClient(deviceId, socketId, io);
};

export const sendMessageWithSelenium = async (deviceId: string, to: string, message: string) => {
  return seleniumWhatsAppManager.sendMessage(deviceId, to, message);
};

export const disconnectWhatsAppClientWithSelenium = async (deviceId: string) => {
  return seleniumWhatsAppManager.disconnectClient(deviceId);
};
