/**
 * QR Code Client Integration Service Tests
 * 
 * Tests for the integration between QR Code Manager and WhatsApp Client Factory
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import qrCodeClientIntegrationService from '../qrcode-client-integration.service';
import { getQRCodeManager, resetQRCodeManager } from '../qrcode-manager.service';
import whatsAppClientFactory from '../whatsapp-client-factory.service';
import { 
  ValidationError, 
  QRGenerationTimeoutError, 
  ClientInitializationError,
  SessionNotFoundError 
} from '../../models/qrcode.errors';

// Mock the WhatsApp Client Factory
vi.mock('../whatsapp-client-factory.service', () => ({
  default: {
    createClient: vi.fn(),
    destroyClient: vi.fn(),
    hasClient: vi.fn(),
    getClient: vi.fn(),
    getActiveDevices: vi.fn(),
    destroyAllClients: vi.fn(),
  }
}));

// Mock the QR Code Manager
vi.mock('../qrcode-manager.service', () => ({
  getQRCodeManager: vi.fn(),
  resetQRCodeManager: vi.fn(),
}));

describe('QRCodeClientIntegrationService', () => {
  let mockQRCodeManager: any;
  let mockClientFactory: any;
  let mockClientWrapper: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

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
    mockClientFactory = whatsAppClientFactory as any;
    mockClientFactory.createClient.mockResolvedValue(mockClientWrapper);
    mockClientFactory.destroyClient.mockResolvedValue(undefined);
    mockClientFactory.hasClient.mockReturnValue(false);

    // Mock getQRCodeManager to return our mock
    (getQRCodeManager as Mock).mockReturnValue(mockQRCodeManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateQRCodeForDevice', () => {
    it('should successfully generate QR code for device', async () => {
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

      // Set up client wrapper to call QR callback
      mockClientWrapper.onQR.mockImplementation((callback: (qr: string) => void) => {
        setTimeout(() => callback(qrCode), 100);
      });

      // Act
      const result = await qrCodeClientIntegrationService.generateQRCodeForDevice(deviceId, userId);

      // Assert
      expect(result).toBe(qrCode);
      expect(mockQRCodeManager.generateQRCode).toHaveBeenCalledWith(deviceId, userId);
      expect(mockClientFactory.createClient).toHaveBeenCalledWith(deviceId, expect.objectContaining({
        deviceId,
        clientType: 'puppeteer',
      }));
      expect(mockClientWrapper.initialize).toHaveBeenCalled();
      expect(mockQRCodeManager.updateSessionWithQRCode).toHaveBeenCalledWith(sessionId, qrCode);
    });

    it('should handle validation errors', async () => {
      // Act & Assert
      await expect(
        qrCodeClientIntegrationService.generateQRCodeForDevice('', 'user-123')
      ).rejects.toThrow(ValidationError);

      await expect(
        qrCodeClientIntegrationService.generateQRCodeForDevice('device-123', '')
      ).rejects.toThrow(ValidationError);
    });

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
        qrCodeClientIntegrationService.generateQRCodeForDevice(deviceId, userId, {
          timeouts: { qrGeneration: 100, connection: 1000, initialization: 1000 }
        })
      ).rejects.toThrow(QRGenerationTimeoutError);
    });

    it('should handle client initialization errors', async () => {
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
      mockClientWrapper.initialize.mockRejectedValue(new ClientInitializationError(deviceId, 'Browser launch failed'));

      // Act & Assert
      await expect(
        qrCodeClientIntegrationService.generateQRCodeForDevice(deviceId, userId)
      ).rejects.toThrow(ClientInitializationError);

      // Verify cleanup was called
      expect(mockClientFactory.destroyClient).toHaveBeenCalledWith(deviceId);
    });

    it('should handle session not found during QR wait', async () => {
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
      mockQRCodeManager.getSession.mockResolvedValue(null); // Session not found

      // Act & Assert
      await expect(
        qrCodeClientIntegrationService.generateQRCodeForDevice(deviceId, userId)
      ).rejects.toThrow(SessionNotFoundError);
    });
  });

  describe('Event Handling', () => {
    it('should handle QR code event correctly', async () => {
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

      let qrCallback: (qr: string) => void;
      mockClientWrapper.onQR.mockImplementation((callback: (qr: string) => void) => {
        qrCallback = callback;
      });

      // Start QR generation
      const qrPromise = qrCodeClientIntegrationService.generateQRCodeForDevice(deviceId, userId);

      // Wait a bit for setup
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate QR code event
      qrCallback!(qrCode);

      // Verify QR code was forwarded to manager
      expect(mockQRCodeManager.updateSessionWithQRCode).toHaveBeenCalledWith(sessionId, qrCode);
    });

    it('should handle ready event correctly', async () => {
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

      // Start QR generation
      const qrPromise = qrCodeClientIntegrationService.generateQRCodeForDevice(deviceId, userId);

      // Wait a bit for setup
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate ready event
      readyCallback!({ wid: 'test@c.us' });

      // Verify session was marked as connected
      expect(mockQRCodeManager.updateSessionStatus).toHaveBeenCalledWith(sessionId, 'connected');
    });

    it('should handle error event correctly', async () => {
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

      // Start QR generation
      const qrPromise = qrCodeClientIntegrationService.generateQRCodeForDevice(deviceId, userId);

      // Wait a bit for setup
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate error event
      const testError = new Error('Test error');
      errorCallback!(testError);

      // Verify session was marked as failed
      expect(mockQRCodeManager.updateSessionStatus).toHaveBeenCalledWith(
        sessionId, 
        'failed', 
        'Test error'
      );
    });

    it('should handle disconnected event correctly', async () => {
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

      // Start QR generation
      const qrPromise = qrCodeClientIntegrationService.generateQRCodeForDevice(deviceId, userId);

      // Wait a bit for setup
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate disconnected event
      disconnectedCallback!('Connection lost');

      // Verify session was marked as failed (since it wasn't connected yet)
      expect(mockQRCodeManager.updateSessionStatus).toHaveBeenCalledWith(
        sessionId, 
        'failed', 
        'Client disconnected: Connection lost'
      );
    });
  });

  describe('Client Management', () => {
    it('should clean up existing client before creating new one', async () => {
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
      mockClientFactory.hasClient.mockReturnValue(true); // Existing client

      // Act
      try {
        await qrCodeClientIntegrationService.generateQRCodeForDevice(deviceId, userId);
      } catch (error) {
        // Ignore timeout error for this test
      }

      // Assert
      expect(mockClientFactory.destroyClient).toHaveBeenCalledWith(deviceId);
    });

    it('should cancel QR code generation', async () => {
      // Arrange
      const deviceId = 'test-device-123';

      // Act
      await qrCodeClientIntegrationService.cancelQRCodeGeneration(deviceId);

      // Assert
      expect(mockClientFactory.destroyClient).toHaveBeenCalledWith(deviceId);
    });

    it('should get active client', () => {
      // Arrange
      const deviceId = 'test-device-123';
      
      // Act
      const result = qrCodeClientIntegrationService.getActiveClient(deviceId);

      // Assert
      expect(result).toBeNull(); // No active client initially
    });

    it('should clean up all clients', async () => {
      // Act
      await qrCodeClientIntegrationService.cleanupAllClients();

      // Assert - should not throw and complete successfully
      expect(true).toBe(true);
    });
  });

  describe('Configuration Handling', () => {
    it('should use custom client configuration', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const userId = 'test-user-456';
      const sessionId = 'test-session-789';

      const customConfig = {
        clientType: 'selenium' as const,
        timeouts: {
          qrGeneration: 15000,
          connection: 30000,
          initialization: 60000,
        },
        seleniumConfig: {
          browserType: 'firefox' as const,
          headless: true,
        },
      };

      const mockSession = {
        sessionId,
        deviceId,
        userId,
        status: 'pending' as const,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        lastUpdated: new Date(),
        clientType: 'selenium' as const,
      };

      mockQRCodeManager.generateQRCode.mockResolvedValue(mockSession);

      // Act
      try {
        await qrCodeClientIntegrationService.generateQRCodeForDevice(deviceId, userId, customConfig);
      } catch (error) {
        // Ignore timeout error for this test
      }

      // Assert
      expect(mockClientFactory.createClient).toHaveBeenCalledWith(deviceId, expect.objectContaining({
        clientType: 'selenium',
        timeouts: customConfig.timeouts,
        seleniumConfig: customConfig.seleniumConfig,
      }));
    });
  });
});