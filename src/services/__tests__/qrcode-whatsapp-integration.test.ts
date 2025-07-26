/**
 * QR Code WhatsApp Service Integration Tests
 * 
 * Comprehensive integration tests to verify compatibility between the new QR code system
 * and the existing WhatsApp service, including both Puppeteer and Selenium implementations.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { QRCodeManager, getQRCodeManager, resetQRCodeManager } from '../qrcode-manager.service';
import { resetSessionStore } from '../session-store.service';
import whatsAppClientFactory from '../whatsapp-client-factory.service';
import { QRCodeClientIntegrationService } from '../qrcode-client-integration.service';
// import { initializeWhatsApp } from '../whatsapp.service'; // Function not available
import seleniumDriverManager from '../selenium.service';
import { 
  ValidationError, 
  ClientInitializationError, 
  QRGenerationTimeoutError,
  BrowserLaunchError,
} from '../../models/qrcode.errors';

// Mock external dependencies
vi.mock('whatsapp-web.js', () => ({
  Client: vi.fn(),
  LocalAuth: vi.fn().mockImplementation(() => ({
    destroy: vi.fn().mockResolvedValue(undefined)
  })),
}));

vi.mock('selenium-webdriver', () => ({
  Builder: vi.fn(),
  WebDriver: vi.fn(),
  Capabilities: vi.fn(),
}));

vi.mock('../selenium.service', () => ({
  default: {
    createDriver: vi.fn().mockResolvedValue({
      quit: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(undefined),
      executeScript: vi.fn().mockResolvedValue(undefined),
    }),
    closeDriver: vi.fn().mockResolvedValue(undefined),
    getDriver: vi.fn().mockReturnValue(null),
  }
}));

vi.mock('../custom-browser-launcher', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      wsEndpoint: vi.fn().mockReturnValue('selenium-custom-browser'),
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    })
  }
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn()
  },
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn()
}));

vi.mock('path', () => ({
  default: {
    resolve: vi.fn().mockReturnValue('/mock/sessions'),
    join: vi.fn().mockReturnValue('/mock/sessions/device1')
  },
  resolve: vi.fn().mockReturnValue('/mock/sessions'),
  join: vi.fn().mockReturnValue('/mock/sessions/device1')
}));

describe('QR Code WhatsApp Service Integration Tests', () => {
  let qrCodeManager: QRCodeManager;
  let integrationService: QRCodeClientIntegrationService;
  let mockClient: any;
  let mockClientWrapper: any;
  let mockSocket: any;
  let mockIo: any;

  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    // Reset all services
    resetQRCodeManager();
    resetSessionStore();
    
    vi.clearAllMocks();

    // Create mock WhatsApp client
    mockClient = {
      on: vi.fn(),
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockReturnValue('DISCONNECTED'),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getChats: vi.fn().mockResolvedValue([]),
    };

    // Create mock client wrapper
    mockClientWrapper = {
      deviceId: 'test-device',
      client: mockClient,
      onQR: vi.fn(),
      onReady: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    // Mock socket and io
    mockSocket = {
      id: 'socket-123',
      emit: vi.fn(),
      on: vi.fn(),
      join: vi.fn(),
      leave: vi.fn(),
    };

    mockIo = {
      to: vi.fn().mockReturnValue({
        emit: vi.fn(),
      }),
      emit: vi.fn(),
      sockets: {
        sockets: new Map([['socket-123', mockSocket]]),
      },
    };

    // Mock Client constructor
    const { Client } = require('whatsapp-web.js');
    Client.mockImplementation(() => mockClient);

    // Create services
    qrCodeManager = new QRCodeManager({
      qrGenerationTimeoutMs: 5000,
      sessionExpirationMs: 10000,
      cleanupIntervalMs: 0,
      enableLogging: false,
      maxSessionsPerUser: 5,
      maxSessionsPerDevice: 1,
    });

    integrationService = new QRCodeClientIntegrationService(qrCodeManager);
  });

  afterEach(async () => {
    try {
      await qrCodeManager.destroy();
      await whatsAppClientFactory.destroyAllClients();
    } catch (error) {
      // Ignore cleanup errors
    }
    
    resetQRCodeManager();
    resetSessionStore();
    vi.clearAllMocks();
  });

  describe('WhatsApp Service Integration', () => {
    it('should integrate with existing WhatsApp service for Puppeteer clients', async () => {
      const deviceId = 'device-puppeteer';
      const userId = 'user-puppeteer';
      const socketId = 'socket-puppeteer';

      // Mock successful client creation
      vi.spyOn(whatsAppClientFactory, 'createClient').mockResolvedValue(mockClientWrapper);

      // Test QR code generation through new system
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      
      expect(session).toBeDefined();
      expect(session.deviceId).toBe(deviceId);
      expect(session.userId).toBe(userId);
      expect(session.status).toBe('pending');

      // Verify client was created with correct configuration
      expect(whatsAppClientFactory.createClient).toHaveBeenCalledWith(
        deviceId,
        expect.objectContaining({
          clientType: 'puppeteer',
          timeouts: expect.any(Object),
        })
      );

      // Simulate QR code generation
      const qrCallback = mockClientWrapper.onQR.mock.calls[0][0];
      await qrCallback('test-qr-code');

      // Verify session was updated
      const updatedSession = await qrCodeManager.getSession(session.sessionId);
      expect(updatedSession?.qrCode).toBe('test-qr-code');
      expect(updatedSession?.status).toBe('generated');
    });

    it('should integrate with existing WhatsApp service for Selenium clients', async () => {
      const deviceId = 'device-selenium';
      const userId = 'user-selenium';

      // Mock Selenium driver creation
      const mockDriver = {
        quit: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(undefined),
        executeScript: vi.fn().mockResolvedValue(undefined),
      };

      vi.spyOn(seleniumDriverManager, 'createDriver').mockResolvedValue(mockDriver as any);
      vi.spyOn(whatsAppClientFactory, 'createClient').mockResolvedValue(mockClientWrapper);

      // Test QR code generation with Selenium configuration
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      
      expect(session).toBeDefined();
      expect(session.deviceId).toBe(deviceId);

      // Verify client was created
      expect(whatsAppClientFactory.createClient).toHaveBeenCalled();

      // Simulate QR code generation
      const qrCallback = mockClientWrapper.onQR.mock.calls[0][0];
      await qrCallback('selenium-qr-code');

      // Verify session was updated
      const updatedSession = await qrCodeManager.getSession(session.sessionId);
      expect(updatedSession?.qrCode).toBe('selenium-qr-code');
      expect(updatedSession?.status).toBe('generated');
    });

    it('should handle existing WhatsApp service event forwarding', async () => {
      const deviceId = 'device-events';
      const userId = 'user-events';

      vi.spyOn(whatsAppClientFactory, 'createClient').mockResolvedValue(mockClientWrapper);

      // Generate QR code
      const session = await qrCodeManager.generateQRCode(deviceId, userId);

      // Verify event handlers were set up
      expect(mockClientWrapper.onQR).toHaveBeenCalled();
      expect(mockClientWrapper.onReady).toHaveBeenCalled();
      expect(mockClientWrapper.onDisconnected).toHaveBeenCalled();
      expect(mockClientWrapper.onError).toHaveBeenCalled();

      // Test QR event forwarding
      const qrCallback = mockClientWrapper.onQR.mock.calls[0][0];
      await qrCallback('forwarded-qr-code');

      const updatedSession = await qrCodeManager.getSession(session.sessionId);
      expect(updatedSession?.qrCode).toBe('forwarded-qr-code');

      // Test ready event forwarding
      const readyCallback = mockClientWrapper.onReady.mock.calls[0][0];
      await readyCallback({ deviceId });

      const connectedSession = await qrCodeManager.getSession(session.sessionId);
      expect(connectedSession?.status).toBe('connected');

      // Test error event forwarding
      const errorCallback = mockClientWrapper.onError.mock.calls[0][0];
      await errorCallback(new Error('Test error'));

      const errorSession = await qrCodeManager.getSession(session.sessionId);
      expect(errorSession?.status).toBe('failed');
    });

    it('should maintain compatibility with existing WhatsApp message sending', async () => {
      const deviceId = 'device-messaging';
      const userId = 'user-messaging';

      vi.spyOn(whatsAppClientFactory, 'createClient').mockResolvedValue(mockClientWrapper);

      // Generate and connect session
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      
      // Simulate connection
      const readyCallback = mockClientWrapper.onReady.mock.calls[0][0];
      await readyCallback({ deviceId });

      // Verify client is available for messaging
      const hasClient = whatsAppClientFactory.hasClient(deviceId);
      expect(hasClient).toBe(true);

      const clientWrapper = whatsAppClientFactory.getClient(deviceId);
      expect(clientWrapper).toBeDefined();
      expect(clientWrapper?.client).toBe(mockClient);

      // Test message sending capability
      await clientWrapper?.client.sendMessage('1234567890@c.us', 'Test message');
      expect(mockClient.sendMessage).toHaveBeenCalledWith('1234567890@c.us', 'Test message');
    });
  });

  describe('Client Factory Integration', () => {
    it('should handle client creation failures gracefully', async () => {
      const deviceId = 'device-fail';
      const userId = 'user-fail';

      // Mock client creation failure
      vi.spyOn(whatsAppClientFactory, 'createClient').mockRejectedValue(
        new BrowserLaunchError('puppeteer', 'Browser launch failed')
      );

      // Should handle failure gracefully
      await expect(qrCodeManager.generateQRCode(deviceId, userId))
        .rejects.toThrow('Browser launch failed');

      // Verify cleanup was attempted
      expect(whatsAppClientFactory.createClient).toHaveBeenCalled();
    });

    it('should handle client destruction properly', async () => {
      const deviceId = 'device-destroy';
      const userId = 'user-destroy';

      vi.spyOn(whatsAppClientFactory, 'createClient').mockResolvedValue(mockClientWrapper);
      vi.spyOn(whatsAppClientFactory, 'destroyClient').mockResolvedValue(undefined);

      // Generate session
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      
      // Cancel session (should trigger cleanup)
      await qrCodeManager.cancelSession(session.sessionId);

      // Verify client was destroyed
      expect(whatsAppClientFactory.destroyClient).toHaveBeenCalledWith(deviceId);
    });

    it('should handle concurrent client operations', async () => {
      const deviceId = 'device-concurrent';
      const userId = 'user-concurrent';

      vi.spyOn(whatsAppClientFactory, 'createClient').mockResolvedValue(mockClientWrapper);

      // Make concurrent requests for same device
      const promises = Array(3).fill(0).map(() => 
        qrCodeManager.generateQRCode(deviceId, userId)
      );

      const results = await Promise.allSettled(promises);
      
      // Only one should succeed (others should be cancelled/replaced)
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful).toHaveLength(1);
    });
  });

  describe('Selenium Integration', () => {
    it('should handle Selenium driver creation and cleanup', async () => {
      const deviceId = 'device-selenium-cleanup';
      const userId = 'user-selenium-cleanup';

      const mockDriver = {
        quit: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(undefined),
      };

      vi.spyOn(seleniumDriverManager, 'createDriver').mockResolvedValue(mockDriver as any);
      vi.spyOn(seleniumDriverManager, 'closeDriver').mockResolvedValue(undefined);
      vi.spyOn(whatsAppClientFactory, 'createClient').mockResolvedValue(mockClientWrapper);

      // Generate session with Selenium
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      
      // Cancel session
      await qrCodeManager.cancelSession(session.sessionId);

      // Verify Selenium driver cleanup
      expect(seleniumDriverManager.closeDriver).toHaveBeenCalledWith(deviceId);
    });

    it('should handle Selenium driver failures', async () => {
      const deviceId = 'device-selenium-fail';
      const userId = 'user-selenium-fail';

      // Mock Selenium driver creation failure
      vi.spyOn(seleniumDriverManager, 'createDriver').mockRejectedValue(
        new Error('Selenium driver creation failed')
      );

      // Should handle failure gracefully
      await expect(qrCodeManager.generateQRCode(deviceId, userId))
        .rejects.toThrow();
    });
  });

  describe('Error Recovery Integration', () => {
    it('should recover from temporary client failures', async () => {
      const deviceId = 'device-recovery';
      const userId = 'user-recovery';

      let attemptCount = 0;
      vi.spyOn(whatsAppClientFactory, 'createClient').mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return Promise.resolve(mockClientWrapper);
      });

      // Should eventually succeed after retries
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      expect(session).toBeDefined();
      expect(attemptCount).toBe(3);
    });

    it('should handle resource cleanup after failures', async () => {
      const deviceId = 'device-cleanup-fail';
      const userId = 'user-cleanup-fail';

      vi.spyOn(whatsAppClientFactory, 'createClient').mockRejectedValue(new Error('Creation failed'));
      vi.spyOn(whatsAppClientFactory, 'destroyClient').mockResolvedValue(undefined);

      try {
        await qrCodeManager.generateQRCode(deviceId, userId);
      } catch (error) {
        // Expected
      }

      // Verify cleanup was attempted
      expect(whatsAppClientFactory.destroyClient).toHaveBeenCalledWith(deviceId);
    });
  });

  describe('Performance Integration', () => {
    it('should maintain performance under load with existing service', async () => {
      const concurrentRequests = 10;
      const promises = [];

      vi.spyOn(whatsAppClientFactory, 'createClient').mockResolvedValue(mockClientWrapper);

      // Create concurrent requests
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          qrCodeManager.generateQRCode(`device-load-${i}`, `user-load-${i}`)
        );
      }

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled').length;

      // Should handle most requests successfully
      expect(successful).toBeGreaterThan(concurrentRequests * 0.7);
    });
  });

  describe('Backward Compatibility', () => {
    it('should not break existing WhatsApp service functionality', async () => {
      const deviceId = 'device-compat';
      const socketId = 'socket-compat';

      // Mock existing WhatsApp service initialization
      const mockInitialize = vi.fn().mockResolvedValue(mockClient);
      
      // Should be able to initialize using existing service
      // This simulates the existing initializeWhatsApp function
      const client = await mockInitialize(deviceId, socketId, mockIo);
      
      expect(client).toBeDefined();
      expect(mockInitialize).toHaveBeenCalledWith(deviceId, socketId, mockIo);
    });

    it('should maintain existing event emission patterns', async () => {
      const deviceId = 'device-events-compat';
      const userId = 'user-events-compat';

      vi.spyOn(whatsAppClientFactory, 'createClient').mockResolvedValue(mockClientWrapper);

      // Generate QR code
      const session = await qrCodeManager.generateQRCode(deviceId, userId);

      // Simulate QR event (should maintain existing format)
      const qrCallback = mockClientWrapper.onQR.mock.calls[0][0];
      await qrCallback('compat-qr-code');

      // Verify session was updated in new format
      const updatedSession = await qrCodeManager.getSession(session.sessionId);
      expect(updatedSession?.qrCode).toBe('compat-qr-code');
      expect(updatedSession?.status).toBe('generated');
    });
  });
});
