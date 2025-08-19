/**
 * WhatsApp Client Factory Integration Tests
 * 
 * Tests for the enhanced WhatsApp Client Factory with QR event handling,
 * timeout management, and retry logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { WhatsAppClientFactory } from '../whatsapp-client-factory.service';
import { 
  ValidationError, 
  ClientInitializationError, 
  BrowserLaunchError,
  QRGenerationTimeoutError 
} from '../../models/qrcode.errors';
import { ClientConfig } from '../../models/qrcode.types';

// Mock whatsapp-web.js
vi.mock('whatsapp-web.js', () => ({
  Client: vi.fn(),
  LocalAuth: vi.fn().mockImplementation(() => ({
    destroy: vi.fn().mockResolvedValue(undefined)
  })),
}));

// Mock selenium service
vi.mock('../selenium.service', () => ({
  default: {
    createDriver: vi.fn(),
    closeDriver: vi.fn(),
  }
}));

// Mock custom browser launcher
vi.mock('../custom-browser-launcher', () => ({
  default: {
    launch: vi.fn(),
  }
}));

describe('WhatsAppClientFactory Integration', () => {
  let factory: WhatsAppClientFactory;
  let mockClient: any;
  let mockDriver: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock WhatsApp client
    mockClient = {
      on: vi.fn(),
      initialize: vi.fn(),
      destroy: vi.fn(),
    };

    // Create mock Selenium driver
    mockDriver = {
      quit: vi.fn(),
    };

    // Set up mock client constructor
    const { Client } = require('whatsapp-web.js');
    vi.mocked(Client).mockImplementation(() => mockClient);

    // Create factory instance
    factory = new WhatsAppClientFactory();
  });

  afterEach(async () => {
    // Clean up any clients
    try {
      await factory.destroyAllClients();
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('Client Creation with Event Handling', () => {
    it('should create Puppeteer client with proper event handlers', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 30000,
          connection: 60000,
          initialization: 120000,
        },
      };

      // Act
      const wrapper = await factory.createClient(deviceId, config);

      // Assert
      expect(wrapper).toBeDefined();
      expect(wrapper.deviceId).toBe(deviceId);
      expect(mockClient.on).toHaveBeenCalledWith('qr', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('auth_failure', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('failure', expect.any(Function));
    });

    it('should create Selenium client with proper event handlers', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'selenium',
        seleniumConfig: {
          browserType: 'chrome',
          headless: false,
        },
        timeouts: {
          qrGeneration: 30000,
          connection: 60000,
          initialization: 120000,
        },
      };

      // Mock selenium driver creation
      const seleniumService = require('../selenium.service').default;
      seleniumService.createDriver.mockResolvedValue(mockDriver);

      // Mock custom browser launcher
      const CustomBrowserLauncher = require('../custom-browser-launcher').default;
      CustomBrowserLauncher.launch.mockResolvedValue({
        close: vi.fn(),
        pages: vi.fn().mockResolvedValue([]),
      });

      // Act
      const wrapper = await factory.createClient(deviceId, config);

      // Assert
      expect(wrapper).toBeDefined();
      expect(wrapper.deviceId).toBe(deviceId);
      expect(seleniumService.createDriver).toHaveBeenCalledWith(
        deviceId,
        'chrome',
        expect.objectContaining({
          headless: false,
          extraArgs: ['--disable-notifications'],
        })
      );
    });

    it('should validate client configuration', async () => {
      // Arrange
      const invalidConfigs = [
        { deviceId: '', clientType: 'puppeteer' as const },
        { deviceId: 'test', clientType: 'invalid' as any },
        { 
          deviceId: 'test', 
          clientType: 'selenium' as const,
          seleniumConfig: { browserType: 'invalid' as any, headless: false }
        },
        {
          deviceId: 'test',
          clientType: 'puppeteer' as const,
          timeouts: { qrGeneration: -1, connection: 60000, initialization: 120000 }
        },
      ];

      // Act & Assert
      for (const config of invalidConfigs) {
        await expect(
          factory.createClient(config.deviceId, config as ClientConfig)
        ).rejects.toThrow(ValidationError);
      }
    });

    it('should prevent duplicate client creation', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 30000,
          connection: 60000,
          initialization: 120000,
        },
      };

      // Act
      await factory.createClient(deviceId, config);

      // Assert
      await expect(
        factory.createClient(deviceId, config)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Event Handler Integration', () => {
    let wrapper: any;
    let qrCallback: (qr: string) => void;
    let readyCallback: (info: any) => void;
    let errorCallback: (error: Error) => void;
    let disconnectedCallback: (reason: string) => void;

    beforeEach(async () => {
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 1000, // Short timeout for testing
          connection: 60000,
          initialization: 120000,
        },
      };

      // Capture event handlers
      mockClient.on.mockImplementation((event: string, handler: Function) => {
        switch (event) {
          case 'qr':
            qrCallback = handler;
            break;
          case 'ready':
            readyCallback = handler;
            break;
          case 'auth_failure':
          case 'failure':
            errorCallback = handler;
            break;
          case 'disconnected':
            disconnectedCallback = handler;
            break;
        }
      });

      wrapper = await factory.createClient(deviceId, config);
    });

    it('should handle QR code events with timeout', async () => {
      // Arrange
      const qrCode = 'test-qr-code';
      let qrReceived = false;
      let timeoutOccurred = false;

      wrapper.onQR((qr: string) => {
        qrReceived = true;
        expect(qr).toBe(qrCode);
      });

      wrapper.onError((error: Error) => {
        if (error instanceof QRGenerationTimeoutError) {
          timeoutOccurred = true;
        }
      });

      // Act - simulate QR event
      qrCallback(qrCode);

      // Assert
      expect(qrReceived).toBe(true);

      // Wait for timeout to potentially occur
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // QR was received, so timeout should not occur
      expect(timeoutOccurred).toBe(false);
    });

    it('should handle QR generation timeout', async () => {
      // Arrange
      let timeoutError: Error | null = null;

      wrapper.onError((error: Error) => {
        timeoutError = error;
      });

      // Act - don't send QR event, let it timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Assert
      expect(timeoutError).toBeInstanceOf(QRGenerationTimeoutError);
    });

    it('should handle ready events', async () => {
      // Arrange
      const clientInfo = { wid: 'test@c.us' };
      let readyReceived = false;

      wrapper.onReady((info: any) => {
        readyReceived = true;
        expect(info).toEqual(clientInfo);
      });

      // Act
      readyCallback(clientInfo);

      // Assert
      expect(readyReceived).toBe(true);
    });

    it('should handle error events', async () => {
      // Arrange
      const testError = new Error('Test error');
      let errorReceived = false;

      wrapper.onError((error: Error) => {
        errorReceived = true;
        expect(error).toBe(testError);
      });

      // Act
      errorCallback(testError);

      // Assert
      expect(errorReceived).toBe(true);
    });

    it('should handle disconnected events', async () => {
      // Arrange
      const reason = 'Connection lost';
      let disconnectedReceived = false;

      wrapper.onDisconnected((disconnectReason: string) => {
        disconnectedReceived = true;
        expect(disconnectReason).toBe(reason);
      });

      // Act
      disconnectedCallback(reason);

      // Assert
      expect(disconnectedReceived).toBe(true);
    });
  });

  describe('Client Initialization with Retry Logic', () => {
    let wrapper: any;

    beforeEach(async () => {
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 30000,
          connection: 60000,
          initialization: 1000, // Short timeout for testing
        },
      };

      wrapper = await factory.createClient(deviceId, config);
    });

    it('should initialize client successfully', async () => {
      // Arrange
      mockClient.initialize.mockResolvedValue(undefined);

      // Act
      await wrapper.initialize();

      // Assert
      expect(mockClient.initialize).toHaveBeenCalled();
    });

    it('should retry initialization on failure', async () => {
      // Arrange
      mockClient.initialize
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockRejectedValueOnce(new Error('Second attempt failed'))
        .mockResolvedValue(undefined); // Third attempt succeeds

      // Act
      await wrapper.initialize();

      // Assert
      expect(mockClient.initialize).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries', async () => {
      // Arrange
      mockClient.initialize.mockRejectedValue(new Error('Persistent failure'));

      // Act & Assert
      await expect(wrapper.initialize()).rejects.toThrow(ClientInitializationError);
      expect(mockClient.initialize).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should handle initialization timeout', async () => {
      // Arrange
      mockClient.initialize.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 2000)) // Longer than timeout
      );

      let timeoutError: Error | null = null;
      wrapper.onError((error: Error) => {
        if (error instanceof ClientInitializationError && error.message.includes('timeout')) {
          timeoutError = error;
        }
      });

      // Act
      try {
        await wrapper.initialize();
      } catch (error) {
        // Expected to fail
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Assert
      expect(timeoutError).toBeTruthy();
    });
  });

  describe('Client Cleanup and Resource Management', () => {
    it('should clean up Puppeteer client properly', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 30000,
          connection: 60000,
          initialization: 120000,
        },
      };

      const wrapper = await factory.createClient(deviceId, config);

      // Act
      await factory.destroyClient(deviceId);

      // Assert
      expect(mockClient.destroy).toHaveBeenCalled();
      expect(factory.hasClient(deviceId)).toBe(false);
    });

    it('should clean up Selenium client properly', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'selenium',
        seleniumConfig: {
          browserType: 'chrome',
          headless: false,
        },
        timeouts: {
          qrGeneration: 30000,
          connection: 60000,
          initialization: 120000,
        },
      };

      // Mock selenium driver creation
      const seleniumService = require('../selenium.service').default;
      seleniumService.createDriver.mockResolvedValue(mockDriver);

      // Mock custom browser launcher
      const CustomBrowserLauncher = require('../custom-browser-launcher').default;
      CustomBrowserLauncher.launch.mockResolvedValue({
        close: vi.fn(),
        pages: vi.fn().mockResolvedValue([]),
      });

      const wrapper = await factory.createClient(deviceId, config);

      // Act
      await factory.destroyClient(deviceId);

      // Assert
      expect(mockClient.destroy).toHaveBeenCalled();
      expect(seleniumService.closeDriver).toHaveBeenCalledWith(deviceId);
      expect(factory.hasClient(deviceId)).toBe(false);
    });

    it('should handle cleanup errors gracefully', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 30000,
          connection: 60000,
          initialization: 120000,
        },
      };

      const wrapper = await factory.createClient(deviceId, config);
      mockClient.destroy.mockRejectedValue(new Error('Cleanup failed'));

      // Act & Assert - should not throw
      await expect(factory.destroyClient(deviceId)).resolves.toBeUndefined();
      expect(factory.hasClient(deviceId)).toBe(false);
    });

    it('should clean up all clients', async () => {
      // Arrange
      const deviceIds = ['device-1', 'device-2', 'device-3'];
      const config: ClientConfig = {
        deviceId: '',
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 30000,
          connection: 60000,
          initialization: 120000,
        },
      };

      for (const deviceId of deviceIds) {
        await factory.createClient(deviceId, { ...config, deviceId });
      }

      // Act
      await factory.destroyAllClients();

      // Assert
      for (const deviceId of deviceIds) {
        expect(factory.hasClient(deviceId)).toBe(false);
      }
      expect(factory.getActiveDevices()).toHaveLength(0);
    });
  });

  describe('Factory Management', () => {
    it('should track active clients', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 30000,
          connection: 60000,
          initialization: 120000,
        },
      };

      // Act
      await factory.createClient(deviceId, config);

      // Assert
      expect(factory.hasClient(deviceId)).toBe(true);
      expect(factory.getClient(deviceId)).toBeTruthy();
      expect(factory.getActiveDevices()).toContain(deviceId);
    });

    it('should return null for non-existent client', () => {
      // Act & Assert
      expect(factory.getClient('non-existent')).toBeNull();
      expect(factory.hasClient('non-existent')).toBe(false);
    });
  });
});