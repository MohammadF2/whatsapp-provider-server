/**
 * QR Code Event Integration Tests
 * 
 * Tests for the QR event handling integration between WhatsApp Client Factory and QR Code Manager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QRCodeClientIntegrationService } from '../qrcode-client-integration.service';
import { WhatsAppClientFactory } from '../whatsapp-client-factory.service';
import { 
  ValidationError, 
  QRGenerationTimeoutError, 
  ClientInitializationError,
  BrowserLaunchError
} from '../../models/qrcode.errors';

describe('QR Code Event Integration', () => {
  let integrationService: QRCodeClientIntegrationService;
  let mockQRCodeManager: any;
  let mockClientFactory: any;
  let mockClientWrapper: any;

  beforeEach(() => {
    // Create mock QR Code Manager
    mockQRCodeManager = {
      generateQRCode: vi.fn(),
      updateSessionWithQRCode: vi.fn(),
      updateSessionStatus: vi.fn(),
      getSession: vi.fn(),
    };

    // Create mock client wrapper
    mockClientWrapper = {
      deviceId: 'test-device-123',
      client: {},
      onQR: vi.fn(),
      onReady: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      initialize: vi.fn(),
      destroy: vi.fn(),
    };

    // Create mock client factory
    mockClientFactory = {
      createClient: vi.fn().mockResolvedValue(mockClientWrapper),
      destroyClient: vi.fn().mockResolvedValue(undefined),
      hasClient: vi.fn().mockReturnValue(false),
      getClient: vi.fn().mockReturnValue(null),
      getActiveDevices: vi.fn().mockReturnValue([]),
      destroyAllClients: vi.fn().mockResolvedValue(undefined),
    };

    // Create integration service with mocked dependencies
    integrationService = new QRCodeClientIntegrationService(mockQRCodeManager);
    (integrationService as any).clientFactory = mockClientFactory;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('QR Event Handling', () => {
    it('should handle QR code event and forward to manager', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const userId = 'test-user-456';
      const sessionId = 'test-session-789';
      const qrCode = 'data:image/png;base64,test-qr-code';

      const mockSession = {
        sessionId,
        deviceId,
        userId,
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        lastUpdated: new Date(),
        clientType: 'puppeteer' as const,
      };

      mockQRCodeManager.generateQRCode.mockResolvedValue(mockSession);
      mockQRCodeManager.getSession.mockResolvedValue({
        ...mockSession,
        qrCode,
        status: 'generated' as const,
      });

      let qrCallback: (qr: string) => void;
      mockClientWrapper.onQR.mockImplementation((callback: (qr: string) => void) => {
        qrCallback = callback;
      });

      // Act
      const qrPromise = integrationService.generateQRCodeForDevice(deviceId, userId);

      // Wait a bit for setup
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate QR code event
      qrCallback!(qrCode);

      // Wait for QR code to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(mockQRCodeManager.updateSessionWithQRCode).toHaveBeenCalledWith(sessionId, qrCode);
    });

    it('should handle ready event and update session status', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const userId = 'test-user-456';
      const sessionId = 'test-session-789';

      const mockSession = {
        sessionId,
        deviceId,
        userId,
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        lastUpdated: new Date(),
        clientType: 'puppeteer' as const,
      };

      mockQRCodeManager.generateQRCode.mockResolvedValue(mockSession);

      let readyCallback: (info: any) => void;
      mockClientWrapper.onReady.mockImplementation((callback: (info: any) => void) => {
        readyCallback = callback;
      });

      // Act
      const qrPromise = integrationService.generateQRCodeForDevice(deviceId, userId);

      // Wait a bit for setup
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate ready event
      readyCallback!({ wid: 'test@c.us' });

      // Wait for event to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(mockQRCodeManager.updateSessionStatus).toHaveBeenCalledWith(sessionId, 'connected');
    });

    it('should handle error event and update session status', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const userId = 'test-user-456';
      const sessionId = 'test-session-789';

      const mockSession = {
        sessionId,
        deviceId,
        userId,
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        lastUpdated: new Date(),
        clientType: 'puppeteer' as const,
      };

      mockQRCodeManager.generateQRCode.mockResolvedValue(mockSession);

      let errorCallback: (error: Error) => void;
      mockClientWrapper.onError.mockImplementation((callback: (error: Error) => void) => {
        errorCallback = callback;
      });

      // Act
      const qrPromise = integrationService.generateQRCodeForDevice(deviceId, userId);

      // Wait a bit for setup
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate error event
      const testError = new Error('Test error');
      errorCallback!(testError);

      // Wait for event to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(mockQRCodeManager.updateSessionStatus).toHaveBeenCalledWith(
        sessionId, 
        'failed', 
        'Test error'
      );
    });

    it('should handle disconnected event and update session status', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const userId = 'test-user-456';
      const sessionId = 'test-session-789';

      const mockSession = {
        sessionId,
        deviceId,
        userId,
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        lastUpdated: new Date(),
        clientType: 'puppeteer' as const,
      };

      mockQRCodeManager.generateQRCode.mockResolvedValue(mockSession);
      mockQRCodeManager.getSession.mockResolvedValue(mockSession);

      let disconnectedCallback: (reason: string) => void;
      mockClientWrapper.onDisconnected.mockImplementation((callback: (reason: string) => void) => {
        disconnectedCallback = callback;
      });

      // Act
      const qrPromise = integrationService.generateQRCodeForDevice(deviceId, userId);

      // Wait a bit for setup
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate disconnected event
      disconnectedCallback!('Connection lost');

      // Wait for event to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(mockQRCodeManager.updateSessionStatus).toHaveBeenCalledWith(
        sessionId, 
        'failed', 
        'Client disconnected: Connection lost'
      );
    });
  });

  describe('Retry Logic', () => {
    it('should retry on browser launch failures', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const userId = 'test-user-456';
      const sessionId = 'test-session-789';

      const mockSession = {
        sessionId,
        deviceId,
        userId,
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        lastUpdated: new Date(),
        clientType: 'puppeteer' as const,
      };

      mockQRCodeManager.generateQRCode.mockResolvedValue(mockSession);

      // First call fails with browser launch error, second succeeds
      mockClientFactory.createClient
        .mockRejectedValueOnce(new BrowserLaunchError('puppeteer', 'Browser launch failed'))
        .mockResolvedValueOnce(mockClientWrapper);

      // Act & Assert
      try {
        await integrationService.generateQRCodeForDevice(deviceId, userId);
      } catch (error) {
        // Expected to fail after retries
      }

      // Should have been called twice (initial + 1 retry)
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(2);
    });

    it('should retry on client initialization errors', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const userId = 'test-user-456';
      const sessionId = 'test-session-789';

      const mockSession = {
        sessionId,
        deviceId,
        userId,
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        lastUpdated: new Date(),
        clientType: 'puppeteer' as const,
      };

      mockQRCodeManager.generateQRCode.mockResolvedValue(mockSession);

      // First call fails with initialization error, second succeeds
      mockClientWrapper.initialize
        .mockRejectedValueOnce(new ClientInitializationError(deviceId, 'Initialization failed'))
        .mockResolvedValueOnce(undefined);

      // Act & Assert
      try {
        await integrationService.generateQRCodeForDevice(deviceId, userId);
      } catch (error) {
        // Expected to fail after retries
      }

      // Should have been called twice (initial + 1 retry)
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(2);
    });

    it('should not retry on validation errors', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const userId = 'test-user-456';
      const sessionId = 'test-session-789';

      const mockSession = {
        sessionId,
        deviceId,
        userId,
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        lastUpdated: new Date(),
        clientType: 'puppeteer' as const,
      };

      mockQRCodeManager.generateQRCode.mockResolvedValue(mockSession);
      mockClientFactory.createClient.mockRejectedValue(new ValidationError('Invalid configuration'));

      // Act & Assert
      await expect(
        integrationService.generateQRCodeForDevice(deviceId, userId)
      ).rejects.toThrow(ValidationError);

      // Should have been called only once (no retry)
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('Timeout Handling', () => {
    it('should handle QR generation timeout', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const userId = 'test-user-456';
      const sessionId = 'test-session-789';

      const mockSession = {
        sessionId,
        deviceId,
        userId,
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        lastUpdated: new Date(),
        clientType: 'puppeteer' as const,
      };

      mockQRCodeManager.generateQRCode.mockResolvedValue(mockSession);
      mockQRCodeManager.getSession.mockResolvedValue(mockSession); // Never changes to generated

      // Act & Assert
      await expect(
        integrationService.generateQRCodeForDevice(deviceId, userId, {
          timeouts: { qrGeneration: 100, connection: 1000, initialization: 1000 }
        })
      ).rejects.toThrow(QRGenerationTimeoutError);
    });

    it('should clear timeout when QR code is received', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const userId = 'test-user-456';
      const sessionId = 'test-session-789';
      const qrCode = 'data:image/png;base64,test-qr-code';

      const mockSession = {
        sessionId,
        deviceId,
        userId,
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        lastUpdated: new Date(),
        clientType: 'puppeteer' as const,
      };

      mockQRCodeManager.generateQRCode.mockResolvedValue(mockSession);
      mockQRCodeManager.getSession.mockResolvedValue({
        ...mockSession,
        qrCode,
        status: 'generated' as const,
      });

      let qrCallback: (qr: string) => void;
      mockClientWrapper.onQR.mockImplementation((callback: (qr: string) => void) => {
        qrCallback = callback;
        // Simulate QR code received immediately
        setTimeout(() => callback(qrCode), 10);
      });

      // Act
      const result = await integrationService.generateQRCodeForDevice(deviceId, userId, {
        timeouts: { qrGeneration: 100, connection: 1000, initialization: 1000 }
      });

      // Assert
      expect(result).toBe(qrCode);
      expect(mockQRCodeManager.updateSessionWithQRCode).toHaveBeenCalledWith(sessionId, qrCode);
    });
  });

  describe('Validation', () => {
    it('should validate device ID and user ID', async () => {
      // Act & Assert
      await expect(
        integrationService.generateQRCodeForDevice('', 'user-123')
      ).rejects.toThrow(ValidationError);

      await expect(
        integrationService.generateQRCodeForDevice('device-123', '')
      ).rejects.toThrow(ValidationError);
    });
  });
});