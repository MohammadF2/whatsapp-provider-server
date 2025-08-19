/**
 * WhatsApp Client Factory Simple Integration Tests
 * 
 * Simplified integration tests for the WhatsAppClientFactory service.
 * Tests the key functionality without complex mocking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsAppClientFactory } from '../whatsapp-client-factory.service';
import { ClientConfig } from '../../models/qrcode.types';
import { ValidationError } from '../../models/qrcode.errors';

// Mock all external dependencies with simple implementations
vi.mock('whatsapp-web.js', () => {
  const mockClient = {
    on: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  
  return {
    Client: vi.fn(() => mockClient),
    LocalAuth: vi.fn(() => ({
      destroy: vi.fn().mockResolvedValue(undefined)
    }))
  };
});

vi.mock('../selenium.service', () => ({
  default: {
    createDriver: vi.fn().mockResolvedValue({
      quit: vi.fn().mockResolvedValue(undefined)
    }),
    closeDriver: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../custom-browser-launcher', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined)
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

describe('WhatsAppClientFactory Simple Integration', () => {
  let factory: WhatsAppClientFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new WhatsAppClientFactory();
  });

  afterEach(async () => {
    try {
      await factory.destroyAllClients();
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('Client Creation and Management', () => {
    const validConfig: ClientConfig = {
      deviceId: 'test-device',
      clientType: 'puppeteer',
      timeouts: {
        qrGeneration: 30000,
        connection: 60000,
        initialization: 120000,
      },
    };

    it('should create and manage Puppeteer client successfully', async () => {
      const deviceId = 'test-device-puppeteer';
      const config = { ...validConfig, deviceId };

      // Create client
      const wrapper = await factory.createClient(deviceId, config);

      // Verify client creation
      expect(wrapper).toBeDefined();
      expect(wrapper.deviceId).toBe(deviceId);
      expect(factory.hasClient(deviceId)).toBe(true);
      expect(factory.getClient(deviceId)).toBe(wrapper);
      expect(factory.getActiveDevices()).toContain(deviceId);

      // Verify event handler registration methods exist
      expect(typeof wrapper.onQR).toBe('function');
      expect(typeof wrapper.onReady).toBe('function');
      expect(typeof wrapper.onDisconnected).toBe('function');
      expect(typeof wrapper.onError).toBe('function');
      expect(typeof wrapper.initialize).toBe('function');
      expect(typeof wrapper.destroy).toBe('function');
    });

    it('should create and manage Selenium client successfully', async () => {
      const deviceId = 'test-device-selenium';
      const config: ClientConfig = {
        ...validConfig,
        deviceId,
        clientType: 'selenium',
        seleniumConfig: {
          browserType: 'chrome',
          headless: true,
        },
      };

      // Create client
      const wrapper = await factory.createClient(deviceId, config);

      // Verify client creation
      expect(wrapper).toBeDefined();
      expect(wrapper.deviceId).toBe(deviceId);
      expect(factory.hasClient(deviceId)).toBe(true);
      expect(factory.getClient(deviceId)).toBe(wrapper);
      expect(factory.getActiveDevices()).toContain(deviceId);
    });

    it('should handle multiple clients simultaneously', async () => {
      const deviceIds = ['device1', 'device2', 'device3'];
      const wrappers: any[] = [];

      // Create multiple clients
      for (const deviceId of deviceIds) {
        const config = { ...validConfig, deviceId };
        const wrapper = await factory.createClient(deviceId, config);
        wrappers.push(wrapper);
      }

      // Verify all clients are tracked
      expect(factory.getActiveDevices()).toHaveLength(3);
      deviceIds.forEach(deviceId => {
        expect(factory.hasClient(deviceId)).toBe(true);
        expect(factory.getActiveDevices()).toContain(deviceId);
      });

      // Destroy one client
      await factory.destroyClient(deviceIds[0]);
      expect(factory.getActiveDevices()).toHaveLength(2);
      expect(factory.hasClient(deviceIds[0])).toBe(false);
      expect(factory.hasClient(deviceIds[1])).toBe(true);
      expect(factory.hasClient(deviceIds[2])).toBe(true);
    });

    it('should prevent duplicate client creation', async () => {
      const deviceId = 'duplicate-device';
      const config = { ...validConfig, deviceId };

      // Create first client
      await factory.createClient(deviceId, config);

      // Attempt to create duplicate
      await expect(factory.createClient(deviceId, config))
        .rejects.toThrow(ValidationError);
    });

    it('should validate configuration properly', async () => {
      // Test invalid device ID
      await expect(factory.createClient('', validConfig))
        .rejects.toThrow(ValidationError);

      // Test invalid client type
      const invalidConfig = { ...validConfig, clientType: 'invalid' as any };
      await expect(factory.createClient('test', invalidConfig))
        .rejects.toThrow(ValidationError);

      // Test invalid timeout
      const invalidTimeoutConfig = {
        ...validConfig,
        timeouts: { ...validConfig.timeouts, qrGeneration: -1000 }
      };
      await expect(factory.createClient('test', invalidTimeoutConfig))
        .rejects.toThrow(ValidationError);
    });

    it('should clean up resources properly', async () => {
      const deviceId = 'cleanup-test';
      const config = { ...validConfig, deviceId };

      // Create client
      const wrapper = await factory.createClient(deviceId, config);
      expect(factory.hasClient(deviceId)).toBe(true);

      // Destroy client
      await factory.destroyClient(deviceId);
      expect(factory.hasClient(deviceId)).toBe(false);
      expect(factory.getClient(deviceId)).toBeNull();
      expect(factory.getActiveDevices()).not.toContain(deviceId);
    });

    it('should destroy all clients', async () => {
      // Create multiple clients
      const deviceIds = ['device1', 'device2', 'device3'];
      for (const deviceId of deviceIds) {
        const config = { ...validConfig, deviceId };
        await factory.createClient(deviceId, config);
      }

      expect(factory.getActiveDevices()).toHaveLength(3);

      // Destroy all clients
      await factory.destroyAllClients();
      expect(factory.getActiveDevices()).toHaveLength(0);
      deviceIds.forEach(deviceId => {
        expect(factory.hasClient(deviceId)).toBe(false);
      });
    });
  });

  describe('Event Handler Registration', () => {
    const validConfig: ClientConfig = {
      deviceId: 'event-test',
      clientType: 'puppeteer',
      timeouts: {
        qrGeneration: 30000,
        connection: 60000,
        initialization: 120000,
      },
    };

    it('should allow event handler registration', async () => {
      const wrapper = await factory.createClient('event-test', validConfig);

      // Test that event handlers can be registered without errors
      expect(() => {
        wrapper.onQR(() => {});
        wrapper.onReady(() => {});
        wrapper.onDisconnected(() => {});
        wrapper.onError(() => {});
      }).not.toThrow();
    });

    it('should validate event handler callbacks', async () => {
      const wrapper = await factory.createClient('validation-test', validConfig);

      // Test that invalid callbacks are rejected
      expect(() => wrapper.onQR(null as any)).toThrow(ValidationError);
      expect(() => wrapper.onReady('invalid' as any)).toThrow(ValidationError);
      expect(() => wrapper.onDisconnected(123 as any)).toThrow(ValidationError);
      expect(() => wrapper.onError({} as any)).toThrow(ValidationError);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent client operations gracefully', async () => {
      // These should not throw errors
      expect(factory.getClient('non-existent')).toBeNull();
      expect(factory.hasClient('non-existent')).toBe(false);
      await expect(factory.destroyClient('non-existent')).resolves.not.toThrow();
    });

    it('should handle empty factory operations', async () => {
      expect(factory.getActiveDevices()).toEqual([]);
      await expect(factory.destroyAllClients()).resolves.not.toThrow();
    });
  });
});