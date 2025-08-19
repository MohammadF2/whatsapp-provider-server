/**
 * WhatsApp Client Factory Service
 * 
 * Factory for creating and managing WhatsApp client instances with proper event handling.
 * Supports both Puppeteer and Selenium WebDriver implementations.
 */

import { Client, LocalAuth } from 'whatsapp-web.js';
import { WebDriver } from 'selenium-webdriver';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import { IWhatsAppClientFactory } from '../models/qrcode.interfaces';
import { ClientConfig, WhatsAppClientWrapper } from '../models/qrcode.types';
import { 
  ClientInitializationError, 
  BrowserLaunchError, 
  ResourceCleanupError,
  ValidationError,
  QRGenerationTimeoutError
} from '../models/qrcode.errors';
import { DEFAULT_CLIENT_CONFIG, DEFAULT_TIMEOUTS } from '../models/qrcode.constants';
import seleniumDriverManager from './selenium.service';
import CustomBrowserLauncher from './custom-browser-launcher';

/**
 * WhatsApp Client Wrapper Implementation
 * 
 * Provides a unified interface for both Puppeteer and Selenium-based WhatsApp clients.
 */
class WhatsAppClientWrapperImpl implements WhatsAppClientWrapper {
  public readonly client: Client;
  public readonly deviceId: string;
  
  private qrCallbacks: ((qr: string) => void)[] = [];
  private readyCallbacks: ((info: any) => void)[] = [];
  private disconnectedCallbacks: ((reason: string) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];
  private driver?: WebDriver;
  private isInitialized = false;
  private isDestroyed = false;
  private qrGenerationTimeout?: NodeJS.Timeout;
  private initializationTimeout?: NodeJS.Timeout;
  private retryCount = 0;
  private maxRetries = 3;
  private readonly config: ClientConfig;

  constructor(client: Client, deviceId: string, config: ClientConfig, driver?: WebDriver) {
    this.client = client;
    this.deviceId = deviceId;
    this.config = config;
    this.driver = driver;
    
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for the WhatsApp client
   */
  private setupEventHandlers(): void {
    // QR code event
    this.client.on('qr', (qr: string) => {
      console.log(`[WhatsAppClientWrapper] QR code received for device ${this.deviceId}`);
      
      // Clear any existing QR generation timeout
      this.clearQRGenerationTimeout();
      
      // Set up QR expiration timeout
      this.setupQRGenerationTimeout();
      
      this.qrCallbacks.forEach(callback => {
        try {
          callback(qr);
        } catch (error) {
          console.error(`[WhatsAppClientWrapper] Error in QR callback for device ${this.deviceId}:`, error);
          this.handleCallbackError(error);
        }
      });
    });

    // Ready event
    this.client.on('ready', () => {
      console.log(`[WhatsAppClientWrapper] Client ready for device ${this.deviceId}`);
      this.isInitialized = true;
      
      // Clear all timeouts since we're connected
      this.clearAllTimeouts();
      
      // Get client info
      const info = (this.client as any).info || {};
      
      this.readyCallbacks.forEach(callback => {
        try {
          callback(info);
        } catch (error) {
          console.error(`[WhatsAppClientWrapper] Error in ready callback for device ${this.deviceId}:`, error);
          this.handleCallbackError(error);
        }
      });
    });

    // Disconnected event
    this.client.on('disconnected', (reason: string) => {
      console.log(`[WhatsAppClientWrapper] Client disconnected for device ${this.deviceId}. Reason: ${reason}`);
      this.isInitialized = false;
      
      // Clear timeouts on disconnection
      this.clearAllTimeouts();
      
      this.disconnectedCallbacks.forEach(callback => {
        try {
          callback(reason);
        } catch (error) {
          console.error(`[WhatsAppClientWrapper] Error in disconnected callback for device ${this.deviceId}:`, error);
          this.handleCallbackError(error);
        }
      });
    });

    // Authentication failure event
    this.client.on('auth_failure', (msg: string) => {
      console.error(`[WhatsAppClientWrapper] Authentication failure for device ${this.deviceId}: ${msg}`);
      
      // Clear timeouts on auth failure
      this.clearAllTimeouts();
      
      const error = new Error(`Authentication failed: ${msg}`);
      
      this.errorCallbacks.forEach(callback => {
        try {
          callback(error);
        } catch (callbackError) {
          console.error(`[WhatsAppClientWrapper] Error in error callback for device ${this.deviceId}:`, callbackError);
          this.handleCallbackError(callbackError);
        }
      });
    });

    // General failure event
    this.client.on('failure', (error: Error) => {
      console.error(`[WhatsAppClientWrapper] General failure for device ${this.deviceId}:`, error);
      
      // Clear timeouts on failure
      this.clearAllTimeouts();
      
      this.errorCallbacks.forEach(callback => {
        try {
          callback(error);
        } catch (callbackError) {
          console.error(`[WhatsAppClientWrapper] Error in error callback for device ${this.deviceId}:`, callbackError);
          this.handleCallbackError(callbackError);
        }
      });
    });

    // Loading screen event for debugging
    this.client.on('loading_screen', (percent: number, message: string) => {
      console.log(`[WhatsAppClientWrapper] Loading screen for device ${this.deviceId}: ${percent}% - ${message}`);
    });
  }

  /**
   * Register callback for QR code events
   */
  onQR(callback: (qr: string) => void): void {
    if (typeof callback !== 'function') {
      throw new ValidationError('QR callback must be a function');
    }
    this.qrCallbacks.push(callback);
  }

  /**
   * Register callback for ready events
   */
  onReady(callback: (info: any) => void): void {
    if (typeof callback !== 'function') {
      throw new ValidationError('Ready callback must be a function');
    }
    this.readyCallbacks.push(callback);
  }

  /**
   * Register callback for disconnection events
   */
  onDisconnected(callback: (reason: string) => void): void {
    if (typeof callback !== 'function') {
      throw new ValidationError('Disconnected callback must be a function');
    }
    this.disconnectedCallbacks.push(callback);
  }

  /**
   * Register callback for error events
   */
  onError(callback: (error: Error) => void): void {
    if (typeof callback !== 'function') {
      throw new ValidationError('Error callback must be a function');
    }
    this.errorCallbacks.push(callback);
  }

  /**
   * Initialize the WhatsApp client with timeout and retry logic
   */
  async initialize(): Promise<void> {
    if (this.isDestroyed) {
      throw new ClientInitializationError(this.deviceId, 'Client has been destroyed');
    }

    if (this.isInitialized) {
      console.log(`[WhatsAppClientWrapper] Client already initialized for device ${this.deviceId}`);
      return;
    }

    return this.initializeWithRetry();
  }

  /**
   * Initialize client with retry logic
   */
  private async initializeWithRetry(): Promise<void> {
    const maxRetries = this.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[WhatsAppClientWrapper] Initializing client for device ${this.deviceId} (attempt ${attempt + 1}/${maxRetries + 1})`);
        
        // Set up initialization timeout
        this.setupInitializationTimeout();
        
        await this.client.initialize();
        
        // Clear timeout on successful initialization
        this.clearInitializationTimeout();
        
        console.log(`[WhatsAppClientWrapper] Client initialization completed for device ${this.deviceId}`);
        return;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[WhatsAppClientWrapper] Client initialization attempt ${attempt + 1} failed for device ${this.deviceId}:`, error);
        
        // Clear timeout on error
        this.clearInitializationTimeout();
        
        // If this is not the last attempt, wait before retrying
        if (attempt < maxRetries) {
          const retryDelay = Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff, max 10s
          console.log(`[WhatsAppClientWrapper] Retrying initialization for device ${this.deviceId} in ${retryDelay}ms`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    // All retries failed
    const errorMessage = lastError ? lastError.message : 'Unknown error';
    throw new ClientInitializationError(this.deviceId, `Failed after ${maxRetries + 1} attempts: ${errorMessage}`);
  }

  /**
   * Destroy the client and clean up resources
   */
  async destroy(): Promise<void> {
    if (this.isDestroyed) {
      console.log(`[WhatsAppClientWrapper] Client already destroyed for device ${this.deviceId}`);
      return;
    }

    console.log(`[WhatsAppClientWrapper] Destroying client for device ${this.deviceId}`);
    this.isDestroyed = true;
    this.isInitialized = false;

    // Clear all timeouts
    this.clearAllTimeouts();

    // Clear all callbacks
    this.qrCallbacks = [];
    this.readyCallbacks = [];
    this.disconnectedCallbacks = [];
    this.errorCallbacks = [];

    try {
      // Destroy WhatsApp client
      if (this.client && typeof this.client.destroy === 'function') {
        console.log(`[WhatsAppClientWrapper] Destroying WhatsApp client for device ${this.deviceId}`);
        
        // Safely destroy the client with null checking
        const pupBrowser = (this.client as any).pupBrowser;
        
        if (!pupBrowser) {
          console.log(`[WhatsAppClientWrapper] Client has no browser to close for device ${this.deviceId}`);
          
          // Clean up auth strategy if available
          if ((this.client as any).authStrategy && typeof (this.client as any).authStrategy.destroy === 'function') {
            await (this.client as any).authStrategy.destroy();
          }
        } else {
          // Normal destroy with browser closing
          await this.client.destroy();
        }
        
        console.log(`[WhatsAppClientWrapper] WhatsApp client destroyed for device ${this.deviceId}`);
      }
    } catch (error) {
      console.warn(`[WhatsAppClientWrapper] Error destroying WhatsApp client for device ${this.deviceId}:`, error);
    }

    try {
      // Close Selenium driver if it exists
      if (this.driver) {
        console.log(`[WhatsAppClientWrapper] Closing Selenium driver for device ${this.deviceId}`);
        
        // Add delay to ensure proper cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await seleniumDriverManager.closeDriver(this.deviceId);
        console.log(`[WhatsAppClientWrapper] Selenium driver closed for device ${this.deviceId}`);
      }
    } catch (error) {
      console.warn(`[WhatsAppClientWrapper] Error closing Selenium driver for device ${this.deviceId}:`, error);
    }
  }

  /**
   * Set up QR generation timeout
   */
  private setupQRGenerationTimeout(): void {
    this.clearQRGenerationTimeout();
    
    this.qrGenerationTimeout = setTimeout(() => {
      console.warn(`[WhatsAppClientWrapper] QR generation timeout for device ${this.deviceId} after ${this.config.timeouts.qrGeneration}ms`);
      
      const error = new QRGenerationTimeoutError(this.deviceId, this.config.timeouts.qrGeneration);
      this.errorCallbacks.forEach(callback => {
        try {
          callback(error);
        } catch (callbackError) {
          console.error(`[WhatsAppClientWrapper] Error in timeout error callback for device ${this.deviceId}:`, callbackError);
        }
      });
    }, this.config.timeouts.qrGeneration);
  }

  /**
   * Clear QR generation timeout
   */
  private clearQRGenerationTimeout(): void {
    if (this.qrGenerationTimeout) {
      clearTimeout(this.qrGenerationTimeout);
      this.qrGenerationTimeout = undefined;
    }
  }

  /**
   * Set up initialization timeout
   */
  private setupInitializationTimeout(): void {
    this.clearInitializationTimeout();
    
    this.initializationTimeout = setTimeout(() => {
      console.warn(`[WhatsAppClientWrapper] Initialization timeout for device ${this.deviceId}`);
      
      const error = new ClientInitializationError(this.deviceId, `Initialization timeout after ${this.config.timeouts.initialization}ms`);
      this.errorCallbacks.forEach(callback => {
        try {
          callback(error);
        } catch (callbackError) {
          console.error(`[WhatsAppClientWrapper] Error in initialization timeout callback for device ${this.deviceId}:`, callbackError);
        }
      });
    }, this.config.timeouts.initialization);
  }

  /**
   * Clear initialization timeout
   */
  private clearInitializationTimeout(): void {
    if (this.initializationTimeout) {
      clearTimeout(this.initializationTimeout);
      this.initializationTimeout = undefined;
    }
  }

  /**
   * Clear all timeouts
   */
  private clearAllTimeouts(): void {
    this.clearQRGenerationTimeout();
    this.clearInitializationTimeout();
  }

  /**
   * Handle callback errors consistently
   */
  private handleCallbackError(error: any): void {
    console.error(`[WhatsAppClientWrapper] Callback error for device ${this.deviceId}:`, error);
    
    // Optionally, you could emit this as an error event or handle it differently
    // For now, we just log it to prevent callback errors from breaking the system
  }
}

/**
 * WhatsApp Client Factory Implementation
 * 
 * Factory for creating and managing WhatsApp client instances with support for
 * both Puppeteer and Selenium WebDriver implementations.
 */
export class WhatsAppClientFactory implements IWhatsAppClientFactory {
  private clients: Map<string, WhatsAppClientWrapper> = new Map();
  private sessionsDir: string;

  constructor() {
    this.sessionsDir = path.resolve(__dirname, '../../sessions');
    this.ensureSessionsDirectory();
  }

  /**
   * Ensure sessions directory exists
   */
  private ensureSessionsDirectory(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      console.log(`[WhatsAppClientFactory] Creating sessions directory: ${this.sessionsDir}`);
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Validate client configuration
   */
  private validateConfig(deviceId: string, config: ClientConfig): void {
    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0) {
      throw new ValidationError('Device ID is required and must be a non-empty string');
    }

    if (!config || typeof config !== 'object') {
      throw new ValidationError('Client configuration is required');
    }

    if (!config.clientType || !['puppeteer', 'selenium'].includes(config.clientType)) {
      throw new ValidationError('Client type must be either "puppeteer" or "selenium"');
    }

    if (config.clientType === 'selenium' && config.seleniumConfig) {
      const { browserType, headless } = config.seleniumConfig;
      
      if (browserType && !['chrome', 'firefox'].includes(browserType)) {
        throw new ValidationError('Selenium browser type must be either "chrome" or "firefox"');
      }
      
      if (headless !== undefined && typeof headless !== 'boolean') {
        throw new ValidationError('Selenium headless option must be a boolean');
      }
    }

    if (config.timeouts) {
      const { qrGeneration, connection, initialization } = config.timeouts;
      
      if (qrGeneration !== undefined && (typeof qrGeneration !== 'number' || qrGeneration <= 0)) {
        throw new ValidationError('QR generation timeout must be a positive number');
      }
      
      if (connection !== undefined && (typeof connection !== 'number' || connection <= 0)) {
        throw new ValidationError('Connection timeout must be a positive number');
      }
      
      if (initialization !== undefined && (typeof initialization !== 'number' || initialization <= 0)) {
        throw new ValidationError('Initialization timeout must be a positive number');
      }
    }
  }

  /**
   * Create a new WhatsApp client wrapper
   */
  async createClient(deviceId: string, config: ClientConfig): Promise<WhatsAppClientWrapper> {
    // Validate input first
    this.validateConfig(deviceId, config);
    
    console.log(`[WhatsAppClientFactory] Creating client for device ${deviceId} with type ${config.clientType}`);

    // Check if client already exists
    if (this.clients.has(deviceId)) {
      throw new ValidationError(`Client already exists for device ${deviceId}`);
    }

    // Merge with default configuration
    const mergedConfig: ClientConfig = {
      ...DEFAULT_CLIENT_CONFIG,
      ...config,
      timeouts: {
        ...DEFAULT_TIMEOUTS,
        ...config.timeouts,
      },
    };

    try {
      let client: Client;
      let driver: WebDriver | undefined;

      if (mergedConfig.clientType === 'selenium') {
        // Create Selenium-based client
        const result = await this.createSeleniumClient(deviceId, mergedConfig);
        client = result.client;
        driver = result.driver;
      } else {
        // Create Puppeteer-based client
        client = await this.createPuppeteerClient(deviceId, mergedConfig);
      }

      // Create wrapper
      const wrapper = new WhatsAppClientWrapperImpl(client, deviceId, mergedConfig, driver);
      
      // Store wrapper
      this.clients.set(deviceId, wrapper);
      
      console.log(`[WhatsAppClientFactory] Client created successfully for device ${deviceId}`);
      return wrapper;
    } catch (error) {
      console.error(`[WhatsAppClientFactory] Failed to create client for device ${deviceId}:`, error);
      
      // Clean up any partial resources
      try {
        await this.destroyClient(deviceId);
      } catch (cleanupError) {
        console.warn(`[WhatsAppClientFactory] Error during cleanup for device ${deviceId}:`, cleanupError);
      }
      
      throw error;
    }
  }

  /**
   * Create a Puppeteer-based WhatsApp client
   */
  private async createPuppeteerClient(deviceId: string, config: ClientConfig): Promise<Client> {
    console.log(`[WhatsAppClientFactory] Creating Puppeteer client for device ${deviceId}`);
    
    try {
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: deviceId,
          dataPath: this.sessionsDir
        }),
        puppeteer: {
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
          ],
          headless: true,
          timeout: config.timeouts.initialization,
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false
        },
        qrMaxRetries: 3, // Reduced from 5 to prevent hanging
        authTimeoutMs: config.timeouts.connection,
        takeoverOnConflict: true,
        takeoverTimeoutMs: config.timeouts.connection + 60000,
        restartOnAuthFail: true
      });

      return client;
    } catch (error) {
      console.error(`[WhatsAppClientFactory] Error creating Puppeteer client for device ${deviceId}:`, error);
      throw new BrowserLaunchError('puppeteer', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Create a Selenium-based WhatsApp client
   */
  private async createSeleniumClient(deviceId: string, config: ClientConfig): Promise<{ client: Client; driver: WebDriver }> {
    console.log(`[WhatsAppClientFactory] Creating Selenium client for device ${deviceId}`);
    
    if (!config.seleniumConfig) {
      throw new ValidationError('Selenium configuration is required for Selenium client type');
    }

    try {
      // Create Selenium WebDriver
      const driver = await seleniumDriverManager.createDriver(
        deviceId,
        config.seleniumConfig.browserType || 'chrome',
        {
          headless: config.seleniumConfig.headless,
          userAgent: config.seleniumConfig.userAgent,
          extraArgs: ['--disable-notifications', '--no-sandbox', '--disable-dev-shm-usage']
        }
      );

      // Create custom puppeteer configuration for Selenium
      const puppeteerConfig: any = {
        executablePath: 'selenium',
        browserWSEndpoint: 'selenium-custom-driver',
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ],
        headless: config.seleniumConfig.headless,
        timeout: config.timeouts.initialization,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        selenium: {
          driver: driver
        }
      };

      // Override puppeteer launcher with custom launcher
      const customLauncher = {
        launch: async (options: any) => {
          console.log(`[WhatsAppClientFactory] Launching browser with Selenium for device ${deviceId}`);
          
          try {
            const customBrowser = await CustomBrowserLauncher.launch(options);
            
            if (customBrowser === null) {
              throw new BrowserLaunchError('selenium', 'Custom browser launcher returned null');
            }
            
            return customBrowser;
          } catch (error) {
            console.error(`[WhatsAppClientFactory] Error in Selenium browser launch for device ${deviceId}:`, error);
            throw new BrowserLaunchError('selenium', error instanceof Error ? error.message : String(error));
          }
        }
      };

      // Create WhatsApp client with Selenium configuration
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: deviceId,
          dataPath: this.sessionsDir
        }),
        puppeteer: {
          ...puppeteerConfig,
          _launcher: customLauncher
        },
        qrMaxRetries: 3, // Reduced from 5 to prevent hanging
        authTimeoutMs: config.timeouts.connection,
        takeoverOnConflict: true,
        takeoverTimeoutMs: config.timeouts.connection + 60000,
        restartOnAuthFail: true,
        userAgent: config.seleniumConfig.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      });

      return { client, driver };
    } catch (error) {
      console.error(`[WhatsAppClientFactory] Error creating Selenium client for device ${deviceId}:`, error);
      
      // Clean up driver if it was created
      try {
        await seleniumDriverManager.closeDriver(deviceId);
      } catch (cleanupError) {
        console.warn(`[WhatsAppClientFactory] Error cleaning up driver after Selenium client creation failure:`, cleanupError);
      }
      
      throw new BrowserLaunchError('selenium', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Destroy a WhatsApp client and clean up resources
   */
  async destroyClient(deviceId: string): Promise<void> {
    console.log(`[WhatsAppClientFactory] Destroying client for device ${deviceId}`);
    
    const wrapper = this.clients.get(deviceId);
    if (!wrapper) {
      console.log(`[WhatsAppClientFactory] No client found for device ${deviceId}`);
      return;
    }

    try {
      // Remove from clients map first
      this.clients.delete(deviceId);
      
      // Destroy the wrapper
      await wrapper.destroy();
      
      console.log(`[WhatsAppClientFactory] Client destroyed successfully for device ${deviceId}`);
    } catch (error) {
      console.error(`[WhatsAppClientFactory] Error destroying client for device ${deviceId}:`, error);
      throw new ResourceCleanupError(`WhatsApp client for device ${deviceId}`, error.message);
    }
  }

  /**
   * Get an existing client wrapper
   */
  getClient(deviceId: string): WhatsAppClientWrapper | null {
    return this.clients.get(deviceId) || null;
  }

  /**
   * Check if a client exists for a device
   */
  hasClient(deviceId: string): boolean {
    return this.clients.has(deviceId);
  }

  /**
   * Get all active client device IDs
   */
  getActiveDevices(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Destroy all clients and clean up resources
   */
  async destroyAllClients(): Promise<void> {
    console.log(`[WhatsAppClientFactory] Destroying all clients (${this.clients.size} clients)`);
    
    const deviceIds = Array.from(this.clients.keys());
    const destroyPromises = deviceIds.map(deviceId => 
      this.destroyClient(deviceId).catch(error => {
        console.error(`[WhatsAppClientFactory] Error destroying client ${deviceId}:`, error);
        return error;
      })
    );

    await Promise.all(destroyPromises);
    
    console.log(`[WhatsAppClientFactory] All clients destroyed`);
  }
}

// Create singleton instance
const whatsAppClientFactory = new WhatsAppClientFactory();

export default whatsAppClientFactory;