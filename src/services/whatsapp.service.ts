import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import Device from '../models/device.model';
import WhatsAppClient from '../models/whatsapp-client.model';
import ProxyDeviceMapping from '../models/proxy-device-mapping.model';
import WebhookManager from './webhook-manager.service';
import { getDecodoProxyService, DecodoProxyService, ProxyInfo } from './decodo-proxy.service';
import { getMessageQueueService, MessageQueueService, QueuedMessage } from './message-queue.service';
import { getProxyConfig, getProxyCountry, isDecodoEnabled, isMessageQueueEnabled } from '../config/proxy.config';

/**
 * WhatsAppClientManager - A class to manage WhatsApp client instances
 *
 * This class provides methods to:
 * - Store and retrieve active client instances
 * - Track client status and metadata
 * - Persist client information to the database
 * - Restore clients from database records
 * - Always prioritize database state over in-memory state
 */
class WhatsAppClientManager {
  // Private storage for active client instances (in-memory cache)
  private clients: { [deviceId: string]: Client } = {};

  // Private storage for client metadata (in-memory cache)
  private metadata: {
    [deviceId: string]: {
      lastActive: Date;
      status: 'disconnected' | 'connecting' | 'connected';
      initialized: boolean;
    }
  } = {};

  // Proxy and message queue services
  private proxyService: DecodoProxyService | null = null;
  private messageQueueService: MessageQueueService | null = null;

  constructor() {
    this.initializeServices();
  }

  /**
   * Initialize proxy and message queue services
   */
  private initializeServices(): void {
    try {
      const config = getProxyConfig();

      // Initialize Decodo proxy service if enabled
      if (isDecodoEnabled()) {
        this.proxyService = getDecodoProxyService(config.decodo);
        console.log('[WhatsAppClientManager] Decodo proxy service initialized');
      }

      // Initialize message queue service if enabled
      if (isMessageQueueEnabled()) {
        this.messageQueueService = getMessageQueueService(config.messageQueue);

        // Set message processor
        this.messageQueueService.setProcessor(async (message: QueuedMessage) => {
          await this.processQueuedMessage(message);
        });

        // Start queue processing
        this.messageQueueService.start();
        console.log('[WhatsAppClientManager] Message queue service initialized');
      }
    } catch (error) {
      console.error('[WhatsAppClientManager] Error initializing services:', error);
    }
  }

  /**
   * Process queued message
   */
  private async processQueuedMessage(message: QueuedMessage): Promise<void> {
    console.log(`[WhatsAppClientManager] Processing queued message for device ${message.deviceId}`);

    try {
      // Check if this is a Selenium client
      const useSelenium = message.metadata?.useSelenium;

      if (useSelenium) {
        console.log(`[WhatsAppClientManager] Using Selenium client for queued message ${message.id}`);
        // Import Selenium service dynamically to avoid circular dependencies
        const { sendMessageWithSelenium } = await import('./whatsapp-selenium.service');
        const result = await sendMessageWithSelenium(message.deviceId, message.to, message.message);

        if (!result.success) {
          throw new Error(result.message || 'Selenium message sending failed');
        }

        console.log(`[WhatsAppClientManager] Selenium queued message sent successfully for device ${message.deviceId}`);
      } else {
        console.log(`[WhatsAppClientManager] Using regular client for queued message ${message.id}`);
        const client = this.clients[message.deviceId];
        if (!client) {
          throw new Error(`No active client found for device ${message.deviceId}`);
        }

        // Send the message using the regular client
        await client.sendMessage(message.to, message.message);
        console.log(`[WhatsAppClientManager] Regular queued message sent successfully for device ${message.deviceId}`);
      }

      // Record successful proxy usage
      await recordProxyUsage(message.deviceId, true);

    } catch (error) {
      console.error(`[WhatsAppClientManager] Error processing queued message for device ${message.deviceId}:`, error);

      // Record failed proxy usage
      await recordProxyUsage(message.deviceId, false);

      throw error;
    }
  }

  /**
   * Get or assign proxy for device
   */
  private async getProxyForDevice(deviceId: string, deviceCountry?: string): Promise<ProxyInfo | null> {
    if (!this.proxyService) {
      return null;
    }

    try {
      // Check if device already has a proxy mapping
      let proxyMapping = await ProxyDeviceMapping.findActiveByDevice(deviceId);

      if (proxyMapping && proxyMapping.isHealthy()) {
        console.log(`[WhatsAppClientManager] Using existing proxy for device ${deviceId}`);
        return {
          id: proxyMapping.proxyId,
          country: proxyMapping.proxyConfig.country,
          city: proxyMapping.proxyConfig.city,
          carrier: proxyMapping.proxyConfig.carrier,
          networkType: proxyMapping.proxyConfig.networkType,
          endpoint: proxyMapping.proxyConfig.endpoint,
          port: proxyMapping.proxyConfig.port,
          isActive: true,
        };
      }

      // Determine target country for proxy
      const targetCountry = deviceCountry ? getProxyCountry(deviceCountry) : 'US';

      // Get new proxy from Decodo service
      const proxy = await this.proxyService.getProxyForDevice(deviceId, {
        country: targetCountry,
        networkType: '4G',
      });

      // Save proxy mapping to database
      if (proxyMapping) {
        // Update existing mapping
        proxyMapping.proxyId = proxy.id;
        proxyMapping.proxyConfig = {
          country: proxy.country,
          city: proxy.city,
          carrier: proxy.carrier,
          networkType: proxy.networkType,
          endpoint: proxy.endpoint,
          port: proxy.port,
        };
        proxyMapping.status = 'active';
        proxyMapping.assignedAt = new Date();
        proxyMapping.failureCount = 0;
        await proxyMapping.save();
      } else {
        // Create new mapping
        proxyMapping = new ProxyDeviceMapping({
          deviceId,
          proxyId: proxy.id,
          proxyConfig: {
            country: proxy.country,
            city: proxy.city,
            carrier: proxy.carrier,
            networkType: proxy.networkType,
            endpoint: proxy.endpoint,
            port: proxy.port,
          },
          status: 'active',
        });
        await proxyMapping.save();
      }

      console.log(`[WhatsAppClientManager] Assigned new proxy ${proxy.id} to device ${deviceId} for country ${targetCountry}`);
      return proxy;

    } catch (error) {
      console.error(`[WhatsAppClientManager] Error getting proxy for device ${deviceId}:`, error);
      return null;
    }
  }

  /**
   * Add a client to the active clients collection and update the database
   * @param deviceId The device ID
   * @param client The WhatsApp client instance
   * @param sessionPath The path to the session directory
   * @param clientConfig Optional client configuration
   */
  async addClient(deviceId: string, client: Client, sessionPath?: string, clientConfig?: any): Promise<void> {
    console.log(`[WhatsAppClientManager] Adding client for device ${deviceId} with database persistence`);

    // Update in-memory cache
    this.clients[deviceId] = client;
    this.metadata[deviceId] = {
      lastActive: new Date(),
      status: 'connecting',
      initialized: false
    };

    // Determine session path
    const finalSessionPath = sessionPath || path.join(path.resolve(__dirname, '../../sessions'), deviceId);

    // Get session files if they exist
    let sessionFiles: string[] = [];
    try {
      if (fs.existsSync(finalSessionPath)) {
        sessionFiles = fs.readdirSync(finalSessionPath);
      }
    } catch (error) {
      console.error(`[WhatsAppClientManager] Error reading session files for device ${deviceId}:`, error);
    }

    // Create or update database record with complete session information
    try {
      await WhatsAppClient.findOneAndUpdate(
        { deviceId },
        {
          deviceId,
          status: 'connecting',
          lastActive: new Date(),
          sessionExists: sessionFiles.length > 0,
          sessionPath: finalSessionPath,
          sessionFiles,
          clientConfig: clientConfig || {
            authStrategy: 'LocalAuth',
            puppeteerOptions: {
              headless: true,
              args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
              ]
            }
          },
          connectionInfo: {
            isReady: false,
            isAuthenticated: false,
            isConnected: false
          }
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );
      console.log(`[WhatsAppClientManager] Client record created/updated in database for device ${deviceId}`);
    } catch (error) {
      console.error(`[WhatsAppClientManager] Error creating/updating client record for device ${deviceId}:`, error);
      throw error; // Don't continue if database update fails
    }
  }

  /**
   * Get a client by device ID, checking database status first
   * @param deviceId The device ID
   * @returns The WhatsApp client instance or undefined if not found
   */
  async getClient(deviceId: string): Promise<Client | undefined> {
    console.log(`[WhatsAppClientManager] Getting client for device ${deviceId} (database-driven)`);

    try {
      // Check database first - this is now the single source of truth
      const whatsappClient = await WhatsAppClient.findOne({ deviceId });

      if (!whatsappClient) {
        console.log(`[WhatsAppClientManager] No database record found for device ${deviceId}`);
        // Clean up any stale memory reference
        if (this.clients[deviceId]) {
          delete this.clients[deviceId];
          delete this.metadata[deviceId];
        }
        return undefined;
      }

      if (whatsappClient.status === 'disconnected') {
        console.log(`[WhatsAppClientManager] Client marked as disconnected in database for device ${deviceId}`);
        // Clean up memory
        if (this.clients[deviceId]) {
          delete this.clients[deviceId];
          delete this.metadata[deviceId];
        }
        return undefined;
      }

      // Client exists and is active in database
      // Check if we have it in memory (cache layer)
      if (this.clients[deviceId]) {
        console.log(`[WhatsAppClientManager] Client found in memory cache for device ${deviceId}`);

        // Validate that the client is properly initialized and ready
        const client = this.clients[deviceId];
        try {
          // Check if client is ready and has proper state
          if (client.info && client.info.wid) {
            console.log(`[WhatsAppClientManager] Client is properly initialized for device ${deviceId}`);
            // Update last active time in database
            await WhatsAppClient.findOneAndUpdate(
              { deviceId },
              { lastActive: new Date() }
            );
            return client;
          } else {
            console.log(`[WhatsAppClientManager] Client in memory but not properly initialized for device ${deviceId}`);
            // Client exists but is not ready - remove it and let it be recreated
            delete this.clients[deviceId];
            delete this.metadata[deviceId];
          }
        } catch (error) {
          console.error(`[WhatsAppClientManager] Error validating client state for device ${deviceId}:`, error);
          // Client is corrupted - remove it
          delete this.clients[deviceId];
          delete this.metadata[deviceId];
        }
      }

      // Client exists in database but not in memory - restore it
      console.log(`[WhatsAppClientManager] Client exists in database but not in memory for device ${deviceId}, restoring from session`);

      if (whatsappClient.sessionExists && whatsappClient.sessionPath) {
        try {
          const restoredClient = await this.restoreClientFromSession(deviceId, whatsappClient);
          if (restoredClient) {
            console.log(`[WhatsAppClientManager] Successfully restored client from session for device ${deviceId}`);
            return restoredClient;
          }
        } catch (error) {
          console.error(`[WhatsAppClientManager] Error restoring client from session for device ${deviceId}:`, error);
        }
      }

      console.log(`[WhatsAppClientManager] Could not restore client for device ${deviceId}`);
      return undefined;

    } catch (error) {
      console.error(`[WhatsAppClientManager] Error getting client for device ${deviceId}:`, error);
      return undefined;
    }
  }

  /**
   * Restore a client from session data stored in database
   * @param deviceId The device ID
   * @param whatsappClient The database record
   * @returns The restored WhatsApp client instance or undefined
   */
  private async restoreClientFromSession(deviceId: string, whatsappClient: any): Promise<Client | undefined> {
    try {
      console.log(`[WhatsAppClientManager] Restoring client from session for device ${deviceId}`);

      // Verify session files exist
      if (!fs.existsSync(whatsappClient.sessionPath)) {
        console.log(`[WhatsAppClientManager] Session path does not exist for device ${deviceId}: ${whatsappClient.sessionPath}`);
        return undefined;
      }

      // Get proxy configuration for device
      const proxy = await this.getProxyForDevice(deviceId);

      // Create client with stored configuration and proxy
      const { Client, LocalAuth } = require('whatsapp-web.js');
      const puppeteerOptions = whatsappClient.clientConfig?.puppeteerOptions || {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      };

      // Add proxy configuration if available
      if (proxy && this.proxyService) {
        const proxyAgent = this.proxyService.createProxyAgent(proxy, 'http');
        puppeteerOptions.args = puppeteerOptions.args || [];
        puppeteerOptions.args.push(`--proxy-server=http://${proxy.endpoint}:${proxy.port}`);
        console.log(`[WhatsAppClientManager] Using proxy ${proxy.id} for device ${deviceId}`);
      }

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: deviceId,
          dataPath: whatsappClient.sessionPath
        }),
        puppeteer: puppeteerOptions
      });

      // Store in memory
      this.clients[deviceId] = client;
      this.metadata[deviceId] = {
        lastActive: new Date(),
        status: 'connecting',
        initialized: false
      };

      // Set up event handlers for restored client
      this.setupClientEventHandlers(deviceId, client);

      // Initialize the client
      await client.initialize();

      return client;
    } catch (error) {
      console.error(`[WhatsAppClientManager] Error restoring client from session for device ${deviceId}:`, error);
      return undefined;
    }
  }

  /**
   * Set up event handlers for a client
   * @param deviceId The device ID
   * @param client The WhatsApp client
   */
  private setupClientEventHandlers(deviceId: string, client: Client): void {
    client.on('ready', async () => {
      console.log(`[WhatsAppClientManager] Restored client ready for device ${deviceId}`);
      await this.markInitialized(deviceId);
    });

    client.on('disconnected', async () => {
      console.log(`[WhatsAppClientManager] Restored client disconnected for device ${deviceId}`);
      await this.removeClient(deviceId);
    });

    client.on('auth_failure', async () => {
      console.log(`[WhatsAppClientManager] Restored client auth failure for device ${deviceId}`);
      await this.removeClient(deviceId);
    });

    // Set up webhook message listener
    client.on('message', async (message) => {
      try {
        // Process message through webhook manager
        const webhookManager = WebhookManager.getInstance();
        await webhookManager.processMessage(deviceId, message);
      } catch (error) {
        console.error(`[WhatsAppClientManager] Error processing incoming message for device ${deviceId}:`, error);
      }
    });
  }

  /**
   * Restore a client from database record (public method for server startup)
   * @param deviceId The device ID
   * @param whatsappClient The database record
   * @returns Promise that resolves when restoration is complete
   */
  async restoreClientFromDatabase(deviceId: string, whatsappClient: any): Promise<void> {
    try {
      console.log(`[WhatsAppClientManager] Restoring client from database for device ${deviceId}`);

      // Check if client already exists in memory
      if (this.clients[deviceId]) {
        console.log(`[WhatsAppClientManager] Client already exists in memory for device ${deviceId}`);
        return;
      }

      // Verify session path exists
      if (!whatsappClient.sessionPath || !fs.existsSync(whatsappClient.sessionPath)) {
        console.log(`[WhatsAppClientManager] Session path does not exist for device ${deviceId}: ${whatsappClient.sessionPath}`);
        throw new Error(`Session path not found: ${whatsappClient.sessionPath}`);
      }

      // Create client with stored configuration
      const { Client, LocalAuth } = require('whatsapp-web.js');
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: deviceId,
          dataPath: whatsappClient.sessionPath
        }),
        puppeteer: whatsappClient.clientConfig?.puppeteerOptions || {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
          ]
        }
      });

      // Store in memory
      this.clients[deviceId] = client;
      this.metadata[deviceId] = {
        lastActive: new Date(),
        status: 'connecting',
        initialized: false
      };

      // Set up event handlers for restored client
      this.setupClientEventHandlers(deviceId, client);

      // Initialize the client
      console.log(`[WhatsAppClientManager] Initializing restored client for device ${deviceId}`);
      await client.initialize();

      console.log(`[WhatsAppClientManager] Successfully restored and initialized client for device ${deviceId}`);
    } catch (error) {
      console.error(`[WhatsAppClientManager] Error restoring client from database for device ${deviceId}:`, error);

      // Clean up on failure
      if (this.clients[deviceId]) {
        delete this.clients[deviceId];
        delete this.metadata[deviceId];
      }

      throw error;
    }
  }

  /**
   * Get a client by device ID synchronously (from memory only)
   * Use this only when you need immediate access and can't wait for async
   * @param deviceId The device ID
   * @returns The WhatsApp client instance or undefined if not found
   */
  getClientSync(deviceId: string): Client | undefined {
    return this.clients[deviceId];
  }

  /**
   * Check if a client exists for a device (checks database first)
   * @param deviceId The device ID
   * @returns True if the client exists, false otherwise
   */
  async hasClient(deviceId: string): Promise<boolean> {
    try {
      // Check WhatsAppClient collection first
      const client = await WhatsAppClient.findOne({ deviceId });
      if (client && client.status !== 'disconnected') {
        // Client exists and is active in the database
        return true;
      }

      // Fallback to Device collection for backward compatibility
      const device = await Device.findById(deviceId);
      if (!device || device.status === 'disconnected') {
        // If device doesn't exist or is disconnected in database,
        // it shouldn't be considered active even if in memory
        return false;
      }

      // If device exists and is active in database, check memory
      return !!this.clients[deviceId];
    } catch (error) {
      console.error(`[WhatsAppClientManager] Error checking database for device ${deviceId}:`, error);
      // Fallback to memory check
      return !!this.clients[deviceId];
    }
  }

  /**
   * Check if a client exists in memory (sync version)
   * @param deviceId The device ID
   * @returns True if the client exists in memory, false otherwise
   */
  hasClientSync(deviceId: string): boolean {
    return !!this.clients[deviceId];
  }

  /**
   * Remove a client from the active clients collection and update database
   * @param deviceId The device ID
   */
  async removeClient(deviceId: string): Promise<void> {
    console.log(`[WhatsAppClientManager] Removing client for device ${deviceId}`);

    // Remove from memory first
    delete this.clients[deviceId];
    delete this.metadata[deviceId];

    // Update the database
    try {
      await this.updateClientStatus(deviceId, 'disconnected');
    } catch (error) {
      console.error(`[WhatsAppClientManager] Error updating client status for device ${deviceId}:`, error);
    }
  }

  /**
   * Get all active client device IDs (from database)
   * @returns Array of device IDs
   */
  async getAllClientIds(): Promise<string[]> {
    try {
      // Get all connected clients from the WhatsAppClient collection
      const clients = await WhatsAppClient.find({ status: 'connected' });

      if (clients.length > 0) {
        return clients.map(client => client.deviceId);
      }

      // Fallback to Device collection for backward compatibility
      const devices = await Device.find({ status: 'connected' });
      return devices.map(device => device._id.toString());
    } catch (error) {
      console.error('[WhatsAppClientManager] Error getting active clients from database:', error);
      // Fallback to in-memory cache
      return Object.keys(this.clients);
    }
  }

  /**
   * Get all active client device IDs from memory (sync version)
   * @returns Array of device IDs
   */
  getAllClientIdsSync(): string[] {
    return Object.keys(this.clients);
  }

  /**
   * Mark a client as initialized and update metadata
   * @param deviceId The device ID
   * @param metadata Optional metadata about the client
   */
  async markInitialized(deviceId: string, metadata?: { name?: string; number?: string; wid?: string; platform?: string; phoneVersion?: string; pushname?: string; profilePicUrl?: string }): Promise<void> {
    if (this.metadata[deviceId]) {
      // Update memory
      this.metadata[deviceId].initialized = true;
      this.metadata[deviceId].status = 'connected';

      // Update the database with complete connection information
      try {
        const updateData: any = {
          status: 'connected',
          lastActive: new Date(),
          'connectionInfo.isReady': true,
          'connectionInfo.isAuthenticated': true,
          'connectionInfo.isConnected': true,
          'connectionInfo.lastSeen': new Date()
        };

        // Add metadata if provided
        if (metadata) {
          updateData.metadata = metadata;
        }

        await WhatsAppClient.findOneAndUpdate(
          { deviceId },
          updateData,
          { upsert: true, new: true }
        );

        console.log(`[WhatsAppClientManager] Client marked as initialized and connected in database for device ${deviceId}`);

        // Also update Device model for backward compatibility
        await Device.findByIdAndUpdate(deviceId, {
          status: 'connected',
          'sessionInfo.lastActive': new Date(),
          'sessionInfo.exists': true,
          whatsappInfo: metadata ? {
            name: metadata.pushname || metadata.name,
            number: metadata.number,
            profilePicUrl: metadata.profilePicUrl || ''
          } : undefined
        });

      } catch (error) {
        console.error(`[WhatsAppClientManager] Error marking client as initialized for device ${deviceId}:`, error);
      }
    }
  }

  /**
   * Check if a client is initialized (from database)
   * @param deviceId The device ID
   * @returns True if the client is initialized, false otherwise
   */
  async isInitialized(deviceId: string): Promise<boolean> {
    try {
      // Check WhatsAppClient collection first
      const client = await WhatsAppClient.findOne({ deviceId });
      if (client) {
        return client.status === 'connected';
      }

      // Fallback to Device collection for backward compatibility
      const device = await Device.findById(deviceId);
      return device?.status === 'connected';
    } catch (error) {
      console.error(`[WhatsAppClientManager] Error checking database for device ${deviceId}:`, error);
      // Fallback to memory
      return this.metadata[deviceId]?.initialized || false;
    }
  }

  /**
   * Update client status in the database
   * @param deviceId The device ID
   * @param status The new status
   */
  private async updateClientStatus(deviceId: string, status: 'disconnected' | 'connecting' | 'connected'): Promise<void> {
    try {
      // Check if session exists
      const sessionsDir = path.resolve(__dirname, '../../sessions');
      const deviceSessionDir = path.join(sessionsDir, deviceId);
      const sessionExists = fs.existsSync(deviceSessionDir) &&
                           fs.readdirSync(deviceSessionDir).length > 0;

      // Update device record in database (for backward compatibility)
      await Device.findByIdAndUpdate(deviceId, {
        status: status,
        sessionInfo: {
          exists: sessionExists,
          lastActive: new Date(),
          ...(status === 'connected' && { lastReconnect: new Date() })
        }
      });

      // Update or create WhatsAppClient record
      const updateData: any = {
        status: status,
        lastActive: new Date(),
        sessionExists: sessionExists
      };

      if (status === 'connected') {
        updateData.lastReconnect = new Date();
      }

      await WhatsAppClient.findOneAndUpdate(
        { deviceId },
        updateData,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      console.log(`[WhatsAppClientManager] Updated client status for device ${deviceId} to ${status}`);
    } catch (error) {
      console.error(`[WhatsAppClientManager] Error updating client status in database for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Synchronize in-memory state with database
   * Call this periodically to ensure memory state matches database
   */
  async syncWithDatabase(): Promise<void> {
    try {
      console.log('[WhatsAppClientManager] Synchronizing with database');

      // Get all WhatsApp clients from database
      const whatsappClients = await WhatsAppClient.find({});

      // Check for clients that should be active but aren't in memory
      for (const client of whatsappClients) {
        const deviceId = client.deviceId;

        // If client is connected in database but not in memory
        if (client.status === 'connected' && !this.clients[deviceId]) {
          console.log(`[WhatsAppClientManager] Client ${deviceId} is connected in database but not in memory`);
          // We don't automatically initialize here - that should be handled by the caller
        }

        // If client is disconnected in database but in memory
        if (client.status === 'disconnected' && this.clients[deviceId]) {
          console.log(`[WhatsAppClientManager] Client ${deviceId} is disconnected in database but in memory - removing`);
          delete this.clients[deviceId];
          delete this.metadata[deviceId];
        }
      }

      // Fallback to Device collection for backward compatibility
      if (whatsappClients.length === 0) {
        console.log('[WhatsAppClientManager] No WhatsApp clients found in database, checking Device collection');

        // Get all devices from database
        const devices = await Device.find({});

        // Check for devices that should be active but aren't in memory
        for (const device of devices) {
          const deviceId = device._id.toString();

          // If device is connected in database but not in memory
          if (device.status === 'connected' && !this.clients[deviceId]) {
            console.log(`[WhatsAppClientManager] Device ${deviceId} is connected in database but not in memory`);

            // Create a WhatsAppClient record for this device
            await WhatsAppClient.findOneAndUpdate(
              { deviceId },
              {
                status: device.status,
                lastActive: device.sessionInfo?.lastActive || new Date(),
                lastReconnect: device.sessionInfo?.lastReconnect,
                sessionExists: device.sessionInfo?.exists || false
              },
              { upsert: true }
            );
          }

          // If device is disconnected in database but in memory
          if (device.status === 'disconnected' && this.clients[deviceId]) {
            console.log(`[WhatsAppClientManager] Device ${deviceId} is disconnected in database but in memory - removing`);
            delete this.clients[deviceId];
            delete this.metadata[deviceId];
          }
        }
      }

      // Check for clients in memory that don't exist in database
      const allDeviceIds = new Set([
        ...whatsappClients.map(client => client.deviceId),
        ...(await Device.find({})).map(device => device._id.toString())
      ]);

      for (const deviceId of Object.keys(this.clients)) {
        if (!allDeviceIds.has(deviceId)) {
          console.log(`[WhatsAppClientManager] Client ${deviceId} exists in memory but not in database - removing`);
          delete this.clients[deviceId];
          delete this.metadata[deviceId];
        }
      }

      console.log('[WhatsAppClientManager] Synchronization complete');
    } catch (error) {
      console.error('[WhatsAppClientManager] Error synchronizing with database:', error);
    }
  }
}

// Create a singleton instance of the client manager
export const activeClients = new WhatsAppClientManager();

// Get the sessions directory path
const getSessionsDir = (): string => {
  return path.resolve(__dirname, '../../sessions');
};

// Check if a session exists for a device
const checkSessionExists = async (deviceId: string): Promise<boolean> => {
  try {
    const sessionsDir = getSessionsDir();

    const deviceSessionDir = path.join(sessionsDir, 'session-'+deviceId);

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

// Interface for custom event emitter
interface CustomEventEmitter {
  emit: (event: string, ...args: any[]) => void;
}

// Initialize WhatsApp client for a device
export const initWhatsAppClient = async (deviceId: string, socketId: string, io: any | CustomEventEmitter) => {
  console.log(`[WhatsApp] Initializing client for device ${deviceId}, socket/session ${socketId}`);
  try {
    // Check if client already exists (in database and memory)
    const clientExists = await activeClients.hasClient(deviceId);
    if (clientExists) {
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
    // Store client in active clients using the manager
    await activeClients.addClient(deviceId, client);

    // Write the session information to the database for future restoration
    console.log(`[WhatsApp] Writing session information to database for device ${deviceId}`);
    try {
      const sessionExists = await checkSessionExists(deviceId);

      await Device.findByIdAndUpdate(deviceId, {
        sessionInfo: {
          exists: sessionExists,
          lastActive: new Date(),

        }
      });

      console.log(`[WhatsApp] Session information written to database for device ${deviceId}`);
    } catch (dbError) {
      console.error(`[WhatsApp] Error writing session information to database for device ${deviceId}:`, dbError);
      // We continue even if this fails, as it's not critical for the connection process
    }

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

        console.log(`[WhatsApp] Sending QR code to socket/session ${socketId} for device ${deviceId}`);

        // Check if io is a socket.io instance or a custom event emitter
        if (typeof io.to === 'function') {
          // Socket.io instance
          io.to(socketId).emit('whatsapp:qr', { deviceId, qrCode: qrDataURL });
        } else {
          // Custom event emitter
          io.emit('qr', qr, qrDataURL);
        }

        console.log(`[WhatsApp] QR code successfully sent for device ${deviceId}`);
      } catch (error) {
        console.error(`[WhatsApp] QR code generation error for device ${deviceId}:`, error);

        // Check if io is a socket.io instance or a custom event emitter
        if (typeof io.to === 'function') {
          // Socket.io instance
          io.to(socketId).emit('whatsapp:error', {
            deviceId,
            message: 'Failed to generate QR code'
          });
        } else {
          // Custom event emitter
          io.emit('error', 'Failed to generate QR code');
        }
      }
    });

    // Ready event
    client.on('ready', async () => {
      console.log(`[WhatsApp] Client ready event triggered for device ${deviceId}`);
      try {
        const clientInfo = client.info;
        console.log(`[WhatsApp] Client info received for device ${deviceId}:`, clientInfo);

        // Extract metadata from client info
        const metadata = {
          name: clientInfo.pushname,
          number: clientInfo.wid.user,
          wid: clientInfo.wid._serialized,
          platform: clientInfo.platform || ''
        };

        // Mark the client as initialized in our manager with metadata
        await activeClients.markInitialized(deviceId, metadata);

        // For backward compatibility, also update the Device model
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

          console.log(`[WhatsApp] Emitting ready event to socket/session ${socketId} for device ${deviceId}`);
          // Notify client
          if (typeof io.to === 'function') {
            // Socket.io instance
            io.to(socketId).emit('whatsapp:ready', {
              deviceId,
              info: device.whatsappInfo
            });
          } else {
            // Custom event emitter
            io.emit('ready', device.whatsappInfo);
          }

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
        // Remove client from active clients using the manager
        activeClients.removeClient(deviceId);

        console.log(`[WhatsApp] Emitting disconnected event for device ${deviceId}`);
        // Notify client
        if (typeof io.to === 'function') {
          // Socket.io instance
          io.emit('whatsapp:disconnected', { deviceId });
        } else {
          // Custom event emitter
          io.emit('disconnected');
        }

        console.log(`[WhatsApp] Client disconnection process completed for device ${deviceId}`);
      } catch (error) {
        console.error(`[WhatsApp] Disconnected event error for device ${deviceId}:`, error);
      }
    });

    // Add authentication failure event
    client.on('auth_failure', (msg) => {
      console.error(`[WhatsApp] Authentication failure for device ${deviceId}:`, msg);

      if (typeof io.to === 'function') {
        // Socket.io instance
        io.to(socketId).emit('whatsapp:error', {
          deviceId,
          message: 'Authentication failed: ' + msg
        });
      } else {
        // Custom event emitter
        io.emit('error', 'Authentication failed: ' + msg);
      }
    });

    // Add general failure event
    client.on('failure', (error) => {
      console.error(`[WhatsApp] General failure for device ${deviceId}:`, error);

      if (typeof io.to === 'function') {
        // Socket.io instance
        io.to(socketId).emit('whatsapp:error', {
          deviceId,
          message: 'Connection failed: ' + error.message
        });
      } else {
        // Custom event emitter
        io.emit('error', 'Connection failed: ' + error.message);
      }
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
    if (activeClients.hasClient(deviceId)) {
      activeClients.removeClient(deviceId);
    }

    return { success: false, message: 'Failed to initialize WhatsApp client: ' + error.message };
  }
};

// Disconnect WhatsApp client
export const disconnectWhatsAppClient = async (deviceId: string) => {
  console.log(`[WhatsApp] Disconnecting client for device ${deviceId}`);
  try {
    const client = await activeClients.getClient(deviceId);
    if (client) {
      console.log(`[WhatsApp] Client found, destroying for device ${deviceId}`);
      await client.destroy();
      console.log(`[WhatsApp] Client destroyed, removing from active clients for device ${deviceId}`);
      await activeClients.removeClient(deviceId);
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

/**
 * Send message through queue (recommended method)
 */
export const sendMessageQueued = async (
  deviceId: string,
  to: string,
  message: string,
  options: {
    priority?: 'low' | 'normal' | 'high';
    type?: 'text' | 'media' | 'button' | 'poll';
    maxAttempts?: number;
    metadata?: Record<string, any>;
  } = {}
): Promise<{ success: boolean; message: string; messageId?: string }> => {
  console.log(`[WhatsApp] Queuing message for device ${deviceId} to ${to}`);

  try {
    // Check if message queue is enabled
    if (!isMessageQueueEnabled()) {
      console.log(`[WhatsApp] Message queue disabled, sending directly`);
      const result = await sendMessage(deviceId, to, message);
      return {
        success: result.success,
        message: result.message || (result.success ? 'Message sent successfully' : 'Failed to send message'),
        messageId: result.messageId,
      };
    }

    const messageQueueService = getMessageQueueService();

    // Enqueue the message
    const success = messageQueueService.enqueueMessage({
      deviceId,
      to,
      message,
      type: options.type || 'text',
      priority: options.priority || 'normal',
      maxAttempts: options.maxAttempts || 3,
      metadata: options.metadata,
    });

    if (success) {
      console.log(`[WhatsApp] Message queued successfully for device ${deviceId}`);
      return {
        success: true,
        message: 'Message queued successfully',
      };
    } else {
      console.log(`[WhatsApp] Failed to queue message for device ${deviceId} - queue full`);
      return {
        success: false,
        message: 'Message queue is full. Please try again later.',
      };
    }
  } catch (error) {
    console.error(`[WhatsApp] Error queuing message for device ${deviceId}:`, error);
    return {
      success: false,
      message: 'Failed to queue message: ' + (error as Error).message,
    };
  }
};

/**
 * Record proxy usage metrics
 */
const recordProxyUsage = async (deviceId: string, success: boolean, responseTime?: number): Promise<void> => {
  try {
    const proxyMapping = await ProxyDeviceMapping.findActiveByDevice(deviceId);
    if (proxyMapping) {
      if (success) {
        proxyMapping.recordSuccess(responseTime);
      } else {
        proxyMapping.recordFailure();
      }
      await proxyMapping.save();
    }
  } catch (error) {
    console.error(`[WhatsApp] Error recording proxy usage for device ${deviceId}:`, error);
  }
};

// Send a message (direct method - use sendMessageQueued instead for better rate limiting)
export const sendMessage = async (deviceId: string, to: string, message: string) => {
  console.log(`[WhatsApp] Sending message for device ${deviceId} to ${to}`);
  try {
    // Check for active client
    const activeIds = await activeClients.getAllClientIds();
    console.log(`[WhatsApp] Active clients: ${activeIds}`);
    let client = await activeClients.getClient(deviceId);

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

          // Store in active clients using the manager
          await activeClients.addClient(deviceId, client);

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
      // Validate client is properly initialized and authenticated
      console.log(`[WhatsApp] Validating client state for device ${deviceId}`);

      // Check if client has proper info (indicates it's authenticated)
      if (!client.info || !client.info.wid) {
        console.log(`[WhatsApp] Client not properly authenticated for device ${deviceId} - missing client info`);

        // Clean up the client
        try {
          await activeClients.removeClient(deviceId);
        } catch (cleanupError) {
          console.error(`[WhatsApp] Error cleaning up client for device ${deviceId}:`, cleanupError);
        }

        return {
          success: false,
          message: 'WhatsApp client not properly authenticated. Please reconnect.',
          needsReconnect: true
        };
      }

      // Check client state before sending
      const state = await client.getState();
      console.log(`[WhatsApp] Client state before sending: ${state} for device ${deviceId}`);

      if (state !== 'CONNECTED') {
        console.log(`[WhatsApp] Client not in CONNECTED state for device ${deviceId}, state: ${state}`);

        // Clean up the client and recommend reconnection
        console.log(`[WhatsApp] Recommending reconnection for device ${deviceId}`);

        // Update device status
        try {
          await Device.findByIdAndUpdate(deviceId, {
            status: 'disconnected',
            sessionInfo: {
              exists: true,
              lastActive: new Date()
            }
          });
          console.log(`[WhatsApp] Updated device status to disconnected for device ${deviceId}`);
        } catch (updateError) {
          console.error(`[WhatsApp] Error updating device status for device ${deviceId}:`, updateError);
        }

        // Clean up the client
        try {
          console.log(`[WhatsApp] Removing client from active clients for device ${deviceId}`);
          activeClients.removeClient(deviceId);
        } catch (cleanupError) {
          console.error(`[WhatsApp] Error cleaning up client for device ${deviceId}:`, cleanupError);
        }

        return {
          success: false,
          message: `WhatsApp client is not connected. Current state: ${state}. Please reconnect by scanning the QR code again.`,
          needsReconnect: true
        };
      }

      // Now try to send the message
      const startTime = Date.now();
      const response = await client.sendMessage(formattedNumber, message);
      const responseTime = Date.now() - startTime;

      console.log(`[WhatsApp] Message sent successfully for device ${deviceId}, message ID: ${response.id.id}, response time: ${responseTime}ms`);

      // Record successful proxy usage
      await recordProxyUsage(deviceId, true, responseTime);

      return { success: true, messageId: response.id.id };
    } catch (sendError) {
      console.error(`[WhatsApp] Error in send operation for device ${deviceId}:`, sendError);

      // Record failed proxy usage
      await recordProxyUsage(deviceId, false);

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
        activeClients.removeClient(deviceId);

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

    // Record failed proxy usage
    await recordProxyUsage(deviceId, false);

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
      activeClients.removeClient(deviceId);

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
  const client = activeClients.getClient(deviceId);
  console.log(`[WhatsApp] Get client for device ${deviceId}: ${client ? 'found' : 'not found'}`);
  return client;
};

// Restore active clients from database on server startup
export const restoreActiveClients = async (): Promise<void> => {
  try {
    console.log('[WhatsApp] Restoring active clients from database (database-driven)');

    // Find all WhatsApp clients that should be active from the database
    const whatsappClients = await WhatsAppClient.find({
      status: { $in: ['connected', 'connecting'] }
    });

    console.log(`[WhatsApp] Found ${whatsappClients.length} active WhatsApp clients in database`);

    // Also check legacy Device records for backward compatibility
    const legacyDevices = await Device.find({
      'sessionInfo.exists': true,
      status: 'connected'
    });

    console.log(`[WhatsApp] Found ${legacyDevices.length} legacy devices with sessions`);

    // Combine both sources
    const allActiveDevices = new Set();

    // Add WhatsApp clients
    whatsappClients.forEach(client => {
      allActiveDevices.add(client.deviceId);
    });

    // Add legacy devices
    legacyDevices.forEach(device => {
      allActiveDevices.add(device._id.toString());
    });

    console.log(`[WhatsApp] Total unique devices to restore: ${allActiveDevices.size}`);

    // Restore each active device
    for (const deviceId of allActiveDevices) {
      try {
        console.log(`[WhatsApp] Attempting to restore client for device ${deviceId}`);

        // Get the WhatsApp client record (primary source)
        let whatsappClient = whatsappClients.find(c => c.deviceId === deviceId);

        // If no WhatsApp client record, create one from legacy device
        if (!whatsappClient) {
          const legacyDevice = legacyDevices.find(d => d._id.toString() === deviceId);
          if (legacyDevice) {
            console.log(`[WhatsApp] Creating WhatsApp client record from legacy device ${deviceId}`);

            // Check if session files exist
            const sessionPath = path.join(path.resolve(__dirname, '../../sessions'), deviceId.toString());
            const sessionExists = fs.existsSync(sessionPath);
            let sessionFiles: string[] = [];

            if (sessionExists) {
              try {
                sessionFiles = fs.readdirSync(sessionPath);
              } catch (error) {
                console.error(`[WhatsApp] Error reading session files for device ${deviceId}:`, error);
              }
            }

            // Create WhatsApp client record
            whatsappClient = await WhatsAppClient.findOneAndUpdate(
              { deviceId },
              {
                deviceId,
                status: 'connected',
                lastActive: legacyDevice.sessionInfo?.lastActive || new Date(),
                sessionExists: sessionExists && sessionFiles.length > 0,
                sessionPath,
                sessionFiles,
                connectionInfo: {
                  isReady: true,
                  isAuthenticated: true,
                  isConnected: true
                }
              },
              { upsert: true, new: true }
            );
          }
        }

        if (!whatsappClient) {
          console.log(`[WhatsApp] No client record found for device ${deviceId}, skipping`);
          continue;
        }

        // Try to restore the client
        await activeClients.restoreClientFromDatabase(deviceId.toString(), whatsappClient);

      } catch (error) {
        console.error(`[WhatsApp] Error restoring client for device ${deviceId}:`, error);

        // Mark as disconnected if restoration fails
        try {
          await WhatsAppClient.findOneAndUpdate(
            { deviceId },
            {
              status: 'disconnected',
              'connectionInfo.isConnected': false,
              'connectionInfo.isReady': false
            }
          );

          await Device.findByIdAndUpdate(deviceId, {
            status: 'disconnected'
          });
        } catch (updateError) {
          console.error(`[WhatsApp] Error updating status for failed device ${deviceId}:`, updateError);
        }
      }
    }

    console.log('[WhatsApp] Finished restoring active clients from database');
  } catch (error) {
    console.error('[WhatsApp] Error restoring active clients:', error);
  }
};

// Test WhatsApp connection by sending a message to self
export const testWhatsAppConnection = async (deviceId: string) => {
  console.log(`[WhatsApp] Testing connection for device ${deviceId}`);
  try {
    // Check for active client
    const activeIds = await activeClients.getAllClientIds();
    console.log(`[WhatsApp] Active clients: ${activeIds}`);
    let client = await activeClients.getClient(deviceId);

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

          // Store in active clients using the manager
          await activeClients.addClient(deviceId, client);

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
        console.log(`[WhatsApp] Client not in CONNECTED state for device ${deviceId}, state: ${state}`);

        // Instead of trying to reset the state, which can cause errors,
        // we'll directly recommend reconnection
        console.log(`[WhatsApp] Recommending reconnection for device ${deviceId}`);

        // Update device status
        try {
          await Device.findByIdAndUpdate(deviceId, {
            status: 'disconnected',
            sessionInfo: {
              exists: true,
              lastActive: new Date()
            }
          });
          console.log(`[WhatsApp] Updated device status to disconnected for device ${deviceId}`);
        } catch (updateError) {
          console.error(`[WhatsApp] Error updating device status for device ${deviceId}:`, updateError);
        }

        // Clean up the client
        try {
          console.log(`[WhatsApp] Removing client from active clients for device ${deviceId}`);
          await activeClients.removeClient(deviceId);
        } catch (cleanupError) {
          console.error(`[WhatsApp] Error cleaning up client for device ${deviceId}:`, cleanupError);
        }

        return {
          success: false,
          message: `WhatsApp client is not connected. Current state: ${state}. Please reconnect by scanning the QR code again.`,
          needsReconnect: true
        };
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
        await activeClients.removeClient(deviceId);

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
