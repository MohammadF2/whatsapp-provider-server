/**
 * Basic QR Code Integration Tests
 * 
 * Simple integration tests to verify the QR event handling works correctly
 * without complex mocking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsAppClientFactory } from '../whatsapp-client-factory.service';
import { 
  ValidationError, 
  ClientInitializationError, 
  QRGenerationTimeoutError 
} from '../../models/qrcode.errors';
import { ClientConfig } from '../../models/qrcode.types';

// Mock whatsapp-web.js
vi.mock('whatsapp-web.js', () => ({
  Client: vi.fn(),
  LocalAuth: vi.fn(),
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

describe('QR Code Integration - Basic Tests', () => {
  let factory: WhatsAppClientFactory;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock WhatsApp client
    mockClient = {
      on: vi.fn(),
      initialize: vi.fn(),
      destroy: vi.fn(),
    };

    // Mock Client constructor
    const { Client } = require('whatsapp-web.js');
    Client.mockImplementation(() => mockClient);

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

  describe('WhatsApp Client Factory Event Integration', () => {
    it('should create client with event handlers and handle QR events', async () => {
      // Arrange
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

      let qrEventHandler: (qr: string) => void;
      let readyEventHandler: (info: any) => void;
      let errorEventHandler: (error: Error) => void;

      // Capture event handlers when they're registered
      mockClient.on.mockImplementation((event: string, handler: Function) => {
        switch (event) {
          case 'qr':
            qrEventHandler = handler;
            break;
          case 'ready':
            readyEventHandler = handler;
            break;
          case 'auth_failure':
          case 'failure':
            errorEventHandler = handler;
            break;
        }
      });

      // Act
      const wrapper = await factory.createClient(deviceId, config);

      // Assert - verify client was created with event handlers
      expect(wrapper).toBeDefined();
      expect(wrapper.deviceId).toBe(deviceId);
      expect(mockClient.on).toHaveBeenCalledWith('qr', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('auth_failure', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('failure', expect.any(Function));

      // Test QR event handling
      let qrReceived = false;
      let receivedQR = '';
      
      wrapper.onQR((qr: string) => {
        qrReceived = true;
        receivedQR = qr;
      });

      // Simulate QR event from WhatsApp client
      const testQR = 'test-qr-code-data';
      qrEventHandler!(testQR);

      expect(qrReceived).toBe(true);
      expect(receivedQR).toBe(testQR);

      // Test ready event handling
      let readyReceived = false;
      let receivedInfo: any;

      wrapper.onReady((info: any) => {
        readyReceived = true;
        receivedInfo = info;
      });

      // Simulate ready event
      const testInfo = { wid: 'test@c.us' };
      readyEventHandler!(testInfo);

      expect(readyReceived).toBe(true);
      expect(receivedInfo).toEqual(testInfo);

      // Test error event handling
      let errorReceived = false;
      let receivedError: Error;

      wrapper.onError((error: Error) => {
        errorReceived = true;
        receivedError = error;
      });

      // Simulate error event
      const testError = new Error('Test error');
      errorEventHandler!(testError);

      expect(errorReceived).toBe(true);
      expect(receivedError).toBe(testError);
    });

    it('should handle QR generation timeout', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 100, // Very short timeout for testing
          connection: 60000,
          initialization: 120000,
        },
      };

      const wrapper = await factory.createClient(deviceId, config);

      // Act - wait for timeout without sending QR event
      let timeoutError: Error | null = null;
      
      wrapper.onError((error: Error) => {
        if (error instanceof QRGenerationTimeoutError) {
          timeoutError = error;
        }
      });

      // Wait for timeout to occur
      await new Promise(resolve => setTimeout(resolve, 150));

      // Assert
      expect(timeoutError).toBeInstanceOf(QRGenerationTimeoutError);
      expect(timeoutError?.message).toContain('test-device-123');
    });

    it('should handle client initialization with retry logic', async () => {
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

      // Test successful initialization
      mockClient.initialize.mockResolvedValue(undefined);
      
      // Act
      await wrapper.initialize();

      // Assert
      expect(mockClient.initialize).toHaveBeenCalledTimes(1);

      // Test retry logic
      mockClient.initialize.mockReset();
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
      mockClient.initialize.mockRejectedValue(new Error('Persistent failure'));

      // Act & Assert
      await expect(wrapper.initialize()).rejects.toThrow(ClientInitializationError);
      expect(mockClient.initialize).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should clean up resources properly', async () => {
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

    it('should validate configuration properly', async () => {
      // Arrange
      const invalidConfigs = [
        { deviceId: '', clientType: 'puppeteer' as const },
        { deviceId: 'test', clientType: 'invalid' as any },
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

    it('should handle multiple event callbacks', async () => {
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

      let qrEventHandler: (qr: string) => void;

      mockClient.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'qr') {
          qrEventHandler = handler;
        }
      });

      const wrapper = await factory.createClient(deviceId, config);

      // Act - register multiple QR callbacks
      let callback1Called = false;
      let callback2Called = false;
      let callback3Called = false;

      wrapper.onQR(() => { callback1Called = true; });
      wrapper.onQR(() => { callback2Called = true; });
      wrapper.onQR(() => { callback3Called = true; });

      // Simulate QR event
      qrEventHandler!('test-qr');

      // Assert
      expect(callback1Called).toBe(true);
      expect(callback2Called).toBe(true);
      expect(callback3Called).toBe(true);
    });

    it('should handle callback errors gracefully', async () => {
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

      let qrEventHandler: (qr: string) => void;

      mockClient.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'qr') {
          qrEventHandler = handler;
        }
      });

      const wrapper = await factory.createClient(deviceId, config);

      // Act - register callbacks that throw errors
      let goodCallbackCalled = false;

      wrapper.onQR(() => { throw new Error('Callback error 1'); });
      wrapper.onQR(() => { goodCallbackCalled = true; });
      wrapper.onQR(() => { throw new Error('Callback error 2'); });

      // Simulate QR event - should not throw despite callback errors
      expect(() => qrEventHandler!('test-qr')).not.toThrow();

      // Assert - good callback should still be called
      expect(goodCallbackCalled).toBe(true);
    });
  });

  describe('Timeout Management', () => {
    it('should clear timeouts on successful connection', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 1000,
          connection: 60000,
          initialization: 120000,
        },
      };

      let qrEventHandler: (qr: string) => void;
      let readyEventHandler: (info: any) => void;

      mockClient.on.mockImplementation((event: string, handler: Function) => {
        switch (event) {
          case 'qr':
            qrEventHandler = handler;
            break;
          case 'ready':
            readyEventHandler = handler;
            break;
        }
      });

      const wrapper = await factory.createClient(deviceId, config);

      let timeoutOccurred = false;
      wrapper.onError((error: Error) => {
        if (error instanceof QRGenerationTimeoutError) {
          timeoutOccurred = true;
        }
      });

      // Act - simulate QR then ready events quickly
      qrEventHandler!('test-qr');
      readyEventHandler!({ wid: 'test@c.us' });

      // Wait longer than QR timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Assert - timeout should not occur since we connected
      expect(timeoutOccurred).toBe(false);
    });

    it('should clear timeouts on disconnection', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 1000,
          connection: 60000,
          initialization: 120000,
        },
      };

      let qrEventHandler: (qr: string) => void;
      let disconnectedEventHandler: (reason: string) => void;

      mockClient.on.mockImplementation((event: string, handler: Function) => {
        switch (event) {
          case 'qr':
            qrEventHandler = handler;
            break;
          case 'disconnected':
            disconnectedEventHandler = handler;
            break;
        }
      });

      const wrapper = await factory.createClient(deviceId, config);

      let timeoutOccurred = false;
      wrapper.onError((error: Error) => {
        if (error instanceof QRGenerationTimeoutError) {
          timeoutOccurred = true;
        }
      });

      // Act - simulate QR then disconnection
      qrEventHandler!('test-qr');
      disconnectedEventHandler!('Connection lost');

      // Wait longer than QR timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Assert - timeout should not occur since we disconnected
      expect(timeoutOccurred).toBe(false);
    });
  });
});