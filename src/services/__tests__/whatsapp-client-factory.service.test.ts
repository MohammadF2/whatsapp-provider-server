/**
 * WhatsApp Client Factory Service Simple Tests
 * 
 * Basic test suite for the WhatsAppClientFactory service implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ValidationError } from '../../models/qrcode.errors';
import { ClientConfig } from '../../models/qrcode.types';

// Mock all external dependencies
vi.mock('whatsapp-web.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    on: vi.fn()
  })),
  LocalAuth: vi.fn().mockImplementation(() => ({
    destroy: vi.fn().mockResolvedValue(undefined)
  }))
}));

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

// Import after mocking
import { WhatsAppClientFactory } from '../whatsapp-client-factory.service';

describe('WhatsAppClientFactory - Basic Tests', () => {
  let factory: WhatsAppClientFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new WhatsAppClientFactory();
  });

  describe('validation', () => {
    const validConfig: ClientConfig = {
      deviceId: 'device1',
      clientType: 'puppeteer',
      timeouts: {
        qrGeneration: 30000,
        connection: 60000,
        initialization: 120000
      }
    };

    it('should throw ValidationError for empty device ID', async () => {
      await expect(factory.createClient('', validConfig))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for null config', async () => {
      await expect(factory.createClient('device1', null as any))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid client type', async () => {
      const invalidConfig = { ...validConfig, clientType: 'invalid' as any };
      
      await expect(factory.createClient('device1', invalidConfig))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid timeout values', async () => {
      const invalidConfig = {
        ...validConfig,
        timeouts: {
          qrGeneration: -1000,
          connection: 60000,
          initialization: 120000
        }
      };
      
      await expect(factory.createClient('device1', invalidConfig))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid Selenium browser type', async () => {
      const invalidConfig: ClientConfig = {
        ...validConfig,
        clientType: 'selenium',
        seleniumConfig: {
          browserType: 'invalid' as any,
          headless: false
        }
      };
      
      await expect(factory.createClient('device1', invalidConfig))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('basic operations', () => {
    it('should return null for non-existent client', () => {
      const client = factory.getClient('non-existent');
      expect(client).toBeNull();
    });

    it('should return false for non-existent client check', () => {
      const hasClient = factory.hasClient('non-existent');
      expect(hasClient).toBe(false);
    });

    it('should return empty array when no clients exist', () => {
      const activeDevices = factory.getActiveDevices();
      expect(activeDevices).toEqual([]);
    });

    it('should handle destroying non-existent client gracefully', async () => {
      await expect(factory.destroyClient('non-existent'))
        .resolves.not.toThrow();
    });

    it('should handle destroying all clients when none exist', async () => {
      await expect(factory.destroyAllClients())
        .resolves.not.toThrow();
    });
  });

  describe('client creation', () => {
    const validConfig: ClientConfig = {
      deviceId: 'device1',
      clientType: 'puppeteer',
      timeouts: {
        qrGeneration: 30000,
        connection: 60000,
        initialization: 120000
      }
    };

    it('should create a client successfully', async () => {
      const wrapper = await factory.createClient('device1', validConfig);

      expect(wrapper).toBeDefined();
      expect(wrapper.deviceId).toBe('device1');
      expect(factory.hasClient('device1')).toBe(true);
    });

    it('should throw error when creating duplicate client', async () => {
      await factory.createClient('device1', validConfig);
      
      await expect(factory.createClient('device1', validConfig))
        .rejects.toThrow(ValidationError);
    });

    it('should track active devices', async () => {
      await factory.createClient('device1', validConfig);
      await factory.createClient('device2', { ...validConfig, deviceId: 'device2' });

      const activeDevices = factory.getActiveDevices();
      expect(activeDevices).toHaveLength(2);
      expect(activeDevices).toContain('device1');
      expect(activeDevices).toContain('device2');
    });

    it('should return created client', async () => {
      const wrapper = await factory.createClient('device1', validConfig);
      const retrieved = factory.getClient('device1');

      expect(retrieved).toBe(wrapper);
    });
  });

  describe('client destruction', () => {
    const validConfig: ClientConfig = {
      deviceId: 'device1',
      clientType: 'puppeteer',
      timeouts: {
        qrGeneration: 30000,
        connection: 60000,
        initialization: 120000
      }
    };

    it('should destroy client successfully', async () => {
      await factory.createClient('device1', validConfig);
      expect(factory.hasClient('device1')).toBe(true);

      await factory.destroyClient('device1');
      expect(factory.hasClient('device1')).toBe(false);
    });

    it('should remove from active devices after destruction', async () => {
      await factory.createClient('device1', validConfig);
      await factory.createClient('device2', { ...validConfig, deviceId: 'device2' });
      
      await factory.destroyClient('device1');

      const activeDevices = factory.getActiveDevices();
      expect(activeDevices).toHaveLength(1);
      expect(activeDevices).toContain('device2');
      expect(activeDevices).not.toContain('device1');
    });

    it('should destroy all clients', async () => {
      await factory.createClient('device1', validConfig);
      await factory.createClient('device2', { ...validConfig, deviceId: 'device2' });
      await factory.createClient('device3', { ...validConfig, deviceId: 'device3' });

      expect(factory.getActiveDevices()).toHaveLength(3);

      await factory.destroyAllClients();

      expect(factory.getActiveDevices()).toHaveLength(0);
    });
  });
});