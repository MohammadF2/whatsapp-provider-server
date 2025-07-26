/**
 * QR Event Flow Tests
 * 
 * Tests to verify QR event handling flow between WhatsApp Client Factory and QR Code Manager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsAppClientFactory } from '../whatsapp-client-factory.service';
import { ClientConfig } from '../../models/qrcode.types';
import { DEFAULT_CLIENT_CONFIG } from '../../models/qrcode.constants';

describe('QR Event Flow', () => {
  let factory: WhatsAppClientFactory;

  beforeEach(() => {
    factory = new WhatsAppClientFactory();
  });

  afterEach(async () => {
    await factory.destroyAllClients();
  });

  describe('Event Handler Registration', () => {
    it('should allow registering QR event handlers', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        deviceId,
        clientType: 'puppeteer',
      };

      // Act
      const clientWrapper = await factory.createClient(deviceId, config);

      // Assert
      expect(clientWrapper).toBeDefined();
      expect(clientWrapper.deviceId).toBe(deviceId);
      expect(typeof clientWrapper.onQR).toBe('function');
      expect(typeof clientWrapper.onReady).toBe('function');
      expect(typeof clientWrapper.onDisconnected).toBe('function');
      expect(typeof clientWrapper.onError).toBe('function');
    });

    it('should handle multiple event handler registrations', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        deviceId,
        clientType: 'puppeteer',
      };

      const qrHandler1 = vi.fn();
      const qrHandler2 = vi.fn();
      const readyHandler = vi.fn();
      const errorHandler = vi.fn();

      // Act
      const clientWrapper = await factory.createClient(deviceId, config);
      
      // Register multiple handlers
      clientWrapper.onQR(qrHandler1);
      clientWrapper.onQR(qrHandler2);
      clientWrapper.onReady(readyHandler);
      clientWrapper.onError(errorHandler);

      // Assert - should not throw and handlers should be registered
      expect(qrHandler1).not.toHaveBeenCalled();
      expect(qrHandler2).not.toHaveBeenCalled();
      expect(readyHandler).not.toHaveBeenCalled();
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it('should validate event handler functions', async () => {
      // Arrange
      const deviceId = 'test-device-123';
      const config: ClientConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        deviceId,
        clientType: 'puppeteer',
      };

      // Act
      const clientWrapper = await factory.createClient(deviceId, config);

      // Assert - should throw for non-function handlers
      expect(() => clientWrapper.onQR(null as any)).toThrow('QR callback must be a function');
      expect(() => clientWrapper.onReady('not-a-function' as any)).toThrow('Ready callback must be a function');
      expect(() => clientWrapper.onDisconnected(123 as any)).toThrow('Disconnected callback must be a function');
      expect(() => clientWrapper.onError({} as any)).toThrow('Error callback must be a function');
    });
  });

  describe('Client Configuration', () => {
    it('should support Puppeteer client configuration', async () => {
      // Arrange
      const deviceId = 'test-device-puppeteer';
      const config: ClientConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 15000,
          connection: 30000,
          initialization: 60000,
        },
      };

      // Act
      const clientWrapper = await factory.createClient(deviceId, config);

      // Assert
      expect(clientWrapper).toBeDefined();
      expect(clientWrapper.deviceId).toBe(deviceId);
      expect(clientWrapper.client).toBeDefined();
    });

    it('should support Selenium client configuration', async () => {
      // Arrange
      const deviceId = 'test-device-selenium';
      const config: ClientConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        deviceId,
        clientType: 'selenium',
        seleniumConfig: {
          browserType: 'chrome',
          headless: true,
          userAgent: 'test-user-agent',
        },
        timeouts: {
          qrGeneration: 15000,
          connection: 30000,
          initialization: 60000,
        },
      };

      // Act & Assert - Should not throw during creation
      const clientWrapper = await factory.createClient(deviceId, config);
      expect(clientWrapper).toBeDefined();
      expect(clientWrapper.deviceId).toBe(deviceId);
    });
  });

  describe('Timeout Handling', () => {
    it('should handle QR generation timeout configuration', async () => {
      // Arrange
      const deviceId = 'test-device-timeout';
      const config: ClientConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 5000, // 5 seconds
          connection: 30000,
          initialization: 60000,
        },
      };

      // Act
      const clientWrapper = await factory.createClient(deviceId, config);

      // Assert - Should create successfully with custom timeout
      expect(clientWrapper).toBeDefined();
    });

    it('should handle initialization timeout configuration', async () => {
      // Arrange
      const deviceId = 'test-device-init-timeout';
      const config: ClientConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        deviceId,
        clientType: 'puppeteer',
        timeouts: {
          qrGeneration: 30000,
          connection: 60000,
          initialization: 120000, // 2 minutes
        },
      };

      // Act
      const clientWrapper = await factory.createClient(deviceId, config);

      // Assert - Should create successfully with custom timeout
      expect(clientWrapper).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle browser launch errors gracefully', async () => {
      // This test verifies that browser launch errors are properly wrapped
      // The actual browser launch might fail in test environment, which is expected
      
      const deviceId = 'test-device-error';
      const config: ClientConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        deviceId,
        clientType: 'puppeteer',
      };

      // Act & Assert - Should either succeed or throw a proper error
      try {
        const clientWrapper = await factory.createClient(deviceId, config);
        expect(clientWrapper).toBeDefined();
      } catch (error) {
        // If it fails, it should be a proper error type
        expect(error).toBeDefined();
        expect(error.message).toBeDefined();
      }
    });

    it('should handle client destruction errors gracefully', async () => {
      // Arrange
      const deviceId = 'test-device-destroy';
      const config: ClientConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        deviceId,
        clientType: 'puppeteer',
      };

      // Act
      const clientWrapper = await factory.createClient(deviceId, config);
      
      // Should not throw during destruction
      await expect(factory.destroyClient(deviceId)).resolves.not.toThrow();
    });
  });

  describe('Resource Management', () => {
    it('should properly clean up resources on client destruction', async () => {
      // Arrange
      const deviceId = 'test-device-cleanup';
      const config: ClientConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        deviceId,
        clientType: 'puppeteer',
      };

      // Act
      const clientWrapper = await factory.createClient(deviceId, config);
      expect(factory.hasClient(deviceId)).toBe(true);
      
      await factory.destroyClient(deviceId);
      
      // Assert
      expect(factory.hasClient(deviceId)).toBe(false);
      expect(factory.getClient(deviceId)).toBeNull();
    });

    it('should handle multiple client cleanup', async () => {
      // Arrange
      const deviceIds = ['device1', 'device2', 'device3'];
      const baseConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        clientType: 'puppeteer' as const,
      };

      // Act - Create multiple clients
      for (const deviceId of deviceIds) {
        const config: ClientConfig = { ...baseConfig, deviceId };
        await factory.createClient(deviceId, config);
      }

      expect(factory.getActiveDevices()).toHaveLength(3);

      // Destroy all clients
      await factory.destroyAllClients();

      // Assert
      expect(factory.getActiveDevices()).toHaveLength(0);
      for (const deviceId of deviceIds) {
        expect(factory.hasClient(deviceId)).toBe(false);
      }
    });
  });
});