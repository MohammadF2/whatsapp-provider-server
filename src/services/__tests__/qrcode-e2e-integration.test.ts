/**
 * End-to-End QR Code Integration Tests
 * 
 * Comprehensive integration tests for the complete QR code flow including:
 * - QR code generation with session management
 * - Event handling and status updates
 * - Error recovery and timeout scenarios
 * - Multi-device concurrent operations
 * - Performance and load testing
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { QRCodeManager, getQRCodeManager, resetQRCodeManager } from '../qrcode-manager.service';
import { getSessionStore, resetSessionStore } from '../session-store.service';
import { rateLimiter } from '../rate-limiter.service';
import { performanceMonitor } from '../performance-monitor.service';
import { healthCheck } from '../health-check.service';
import { timeoutManager } from '../timeout-manager.service';
import { errorRecoveryService } from '../error-recovery.service';
import { 
  ValidationError, 
  SessionNotFoundError, 
  QRGenerationTimeoutError,
  ClientInitializationError,
  ConcurrentSessionError,
  DeviceNotFoundError,
  DeviceAlreadyConnectedError,
} from '../../models/qrcode.errors';

// Mock external dependencies
vi.mock('whatsapp-web.js', () => ({
  Client: vi.fn(),
  LocalAuth: vi.fn(),
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

describe('QR Code E2E Integration Tests', () => {
  let qrCodeManager: QRCodeManager;
  let mockClient: any;
  let mockClientWrapper: any;

  beforeAll(() => {
    // Set up global test environment
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    // Reset all services
    resetQRCodeManager();
    resetSessionStore();
    rateLimiter.clear();
    performanceMonitor.clearAllMetrics();
    timeoutManager.clearAllTimeouts();
    
    // Clear all mocks
    vi.clearAllMocks();

    // Create mock WhatsApp client
    mockClient = {
      on: vi.fn(),
      initialize: vi.fn(),
      destroy: vi.fn(),
      getState: vi.fn().mockReturnValue('DISCONNECTED'),
    };

    // Create mock client wrapper
    mockClientWrapper = {
      deviceId: 'test-device-123',
      client: mockClient,
      onQR: vi.fn(),
      onReady: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      initialize: vi.fn(),
      destroy: vi.fn(),
    };

    // Mock Client constructor
    const { Client } = require('whatsapp-web.js');
    Client.mockImplementation(() => mockClient);

    // Create QR Code Manager with test configuration
    qrCodeManager = new QRCodeManager({
      qrGenerationTimeoutMs: 5000,
      sessionExpirationMs: 10000,
      cleanupIntervalMs: 0,
      enableLogging: false,
      maxSessionsPerUser: 3,
      maxSessionsPerDevice: 1,
    });
  });

  afterEach(async () => {
    // Clean up after each test
    try {
      await qrCodeManager.destroy();
    } catch (error) {
      // Ignore cleanup errors
    }
    
    resetQRCodeManager();
    resetSessionStore();
    vi.clearAllMocks();
  });

  describe('Complete QR Code Flow', () => {
    it('should complete full QR code generation and authentication flow', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';
      const qrCode = 'data:image/png;base64,test-qr-code';

      // Mock successful client initialization
      mockClientWrapper.initialize.mockResolvedValue(undefined);
      
      // Mock WhatsApp client factory
      const mockFactory = {
        createClient: vi.fn().mockResolvedValue(mockClientWrapper),
        hasClient: vi.fn().mockReturnValue(false),
        destroyClient: vi.fn().mockResolvedValue(undefined),
      };
      
      vi.doMock('../whatsapp-client-factory.service', () => ({
        default: mockFactory,
      }));

      // Step 1: Generate QR code
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      
      expect(session).toBeDefined();
      expect(session.deviceId).toBe(deviceId);
      expect(session.userId).toBe(userId);
      expect(session.status).toBe('pending');
      expect(mockFactory.createClient).toHaveBeenCalledWith(deviceId, expect.any(Object));

      // Step 2: Simulate QR code event
      const qrCallback = mockClientWrapper.onQR.mock.calls[0][0];
      await qrCallback(qrCode);

      // Verify QR code was updated
      const updatedSession = await qrCodeManager.getSession(session.sessionId);
      expect(updatedSession?.qrCode).toBe(qrCode);
      expect(updatedSession?.status).toBe('generated');

      // Step 3: Simulate successful authentication
      const readyCallback = mockClientWrapper.onReady.mock.calls[0][0];
      await readyCallback({ deviceId });

      // Verify session is connected
      const finalSession = await qrCodeManager.getSession(session.sessionId);
      expect(finalSession?.status).toBe('connected');
    });

    it('should handle QR generation timeout gracefully', async () => {
      const deviceId = 'device-timeout';
      const userId = 'user-timeout';

      // Mock client that never generates QR
      mockClientWrapper.initialize.mockImplementation(() => {
        // Don't call QR callback, simulate timeout
        return new Promise(() => {}); // Never resolves
      });

      const mockFactory = {
        createClient: vi.fn().mockResolvedValue(mockClientWrapper),
        hasClient: vi.fn().mockReturnValue(false),
        destroyClient: vi.fn().mockResolvedValue(undefined),
      };
      
      vi.doMock('../whatsapp-client-factory.service', () => ({
        default: mockFactory,
      }));

      // Generate QR code
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      
      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(6000); // Beyond 5000ms timeout
      
      // Wait for timeout to be processed
      await vi.runAllTimersAsync();

      // Verify session expired
      const expiredSession = await qrCodeManager.getSession(session.sessionId);
      expect(expiredSession?.status).toBe('expired');
    });

    it('should handle client initialization errors', async () => {
      const deviceId = 'device-error';
      const userId = 'user-error';

      // Mock client that fails to initialize
      mockClientWrapper.initialize.mockRejectedValue(new Error('Browser launch failed'));

      const mockFactory = {
        createClient: vi.fn().mockResolvedValue(mockClientWrapper),
        hasClient: vi.fn().mockReturnValue(false),
        destroyClient: vi.fn().mockResolvedValue(undefined),
      };
      
      vi.doMock('../whatsapp-client-factory.service', () => ({
        default: mockFactory,
      }));

      // Attempt to generate QR code
      await expect(qrCodeManager.generateQRCode(deviceId, userId))
        .rejects.toThrow('Browser launch failed');
    });
  });

  describe('Multi-Device Concurrent Operations', () => {
    it('should handle multiple devices for same user', async () => {
      const userId = 'user-multi';
      const devices = ['device-1', 'device-2', 'device-3'];

      const mockFactory = {
        createClient: vi.fn().mockResolvedValue(mockClientWrapper),
        hasClient: vi.fn().mockReturnValue(false),
        destroyClient: vi.fn().mockResolvedValue(undefined),
      };
      
      vi.doMock('../whatsapp-client-factory.service', () => ({
        default: mockFactory,
      }));

      // Generate QR codes for multiple devices
      const sessions = await Promise.all(
        devices.map(deviceId => qrCodeManager.generateQRCode(deviceId, userId))
      );

      expect(sessions).toHaveLength(3);
      expect(sessions.every(session => session.userId === userId)).toBe(true);
      expect(new Set(sessions.map(s => s.deviceId)).size).toBe(3);
    });

    it('should enforce max sessions per user limit', async () => {
      const userId = 'user-limit';
      const devices = ['device-1', 'device-2', 'device-3', 'device-4'];

      const mockFactory = {
        createClient: vi.fn().mockResolvedValue(mockClientWrapper),
        hasClient: vi.fn().mockReturnValue(false),
        destroyClient: vi.fn().mockResolvedValue(undefined),
      };
      
      vi.doMock('../whatsapp-client-factory.service', () => ({
        default: mockFactory,
      }));

      // Generate QR codes up to limit
      const sessions = await Promise.all(
        devices.slice(0, 3).map(deviceId => qrCodeManager.generateQRCode(deviceId, userId))
      );

      expect(sessions).toHaveLength(3);

      // Fourth device should fail
      await expect(qrCodeManager.generateQRCode(devices[3], userId))
        .rejects.toThrow(ConcurrentSessionError);
    });

    it('should handle concurrent requests for same device', async () => {
      const deviceId = 'device-concurrent';
      const userId = 'user-concurrent';

      const mockFactory = {
        createClient: vi.fn().mockResolvedValue(mockClientWrapper),
        hasClient: vi.fn().mockReturnValue(false),
        destroyClient: vi.fn().mockResolvedValue(undefined),
      };
      
      vi.doMock('../whatsapp-client-factory.service', () => ({
        default: mockFactory,
      }));

      // Make concurrent requests for same device
      const promises = Array(3).fill(0).map(() => 
        qrCodeManager.generateQRCode(deviceId, userId)
      );

      const results = await Promise.allSettled(promises);
      
      // Only one should succeed, others should be cancelled/replaced
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful).toHaveLength(1);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from temporary network failures', async () => {
      const deviceId = 'device-recovery';
      const userId = 'user-recovery';

      let attemptCount = 0;
      mockClientWrapper.initialize.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Network timeout');
        }
        return Promise.resolve();
      });

      const mockFactory = {
        createClient: vi.fn().mockResolvedValue(mockClientWrapper),
        hasClient: vi.fn().mockReturnValue(false),
        destroyClient: vi.fn().mockResolvedValue(undefined),
      };
      
      vi.doMock('../whatsapp-client-factory.service', () => ({
        default: mockFactory,
      }));

      // Should eventually succeed after retries
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      expect(session).toBeDefined();
      expect(attemptCount).toBe(3);
    });

    it('should handle memory pressure gracefully', async () => {
      const userId = 'user-memory';
      
      // Create many sessions to simulate memory pressure
      const sessions = [];
      for (let i = 0; i < 50; i++) {
        try {
          const session = await qrCodeManager.generateQRCode(`device-${i}`, userId);
          sessions.push(session);
        } catch (error) {
          // Expected when hitting limits
          break;
        }
      }

      // Verify system is still responsive
      const healthStatus = await healthCheck.getSimpleHealth();
      expect(['healthy', 'degraded']).toContain(healthStatus.status);
    });
  });

  describe('Performance and Load Testing', () => {
    it('should handle high load of QR generation requests', async () => {
      const startTime = Date.now();
      const requests = 20;
      const promises = [];

      const mockFactory = {
        createClient: vi.fn().mockResolvedValue(mockClientWrapper),
        hasClient: vi.fn().mockReturnValue(false),
        destroyClient: vi.fn().mockResolvedValue(undefined),
      };
      
      vi.doMock('../whatsapp-client-factory.service', () => ({
        default: mockFactory,
      }));

      // Generate multiple QR codes concurrently
      for (let i = 0; i < requests; i++) {
        promises.push(
          qrCodeManager.generateQRCode(`device-load-${i}`, `user-load-${i}`)
        );
      }

      const results = await Promise.allSettled(promises);
      const endTime = Date.now();
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const duration = endTime - startTime;

      // Verify performance metrics
      expect(successful).toBeGreaterThan(requests * 0.8); // At least 80% success
      expect(duration).toBeLessThan(10000); // Complete within 10 seconds

      // Check performance monitoring
      const metrics = performanceMonitor.getAllMetrics();
      expect(Object.keys(metrics)).toContain('qr-code-generation');
    });

    it('should maintain performance under sustained load', async () => {
      const batchSize = 10;
      const batches = 3;
      const results = [];

      const mockFactory = {
        createClient: vi.fn().mockResolvedValue(mockClientWrapper),
        hasClient: vi.fn().mockReturnValue(false),
        destroyClient: vi.fn().mockResolvedValue(undefined),
      };
      
      vi.doMock('../whatsapp-client-factory.service', () => ({
        default: mockFactory,
      }));

      // Run multiple batches with delays
      for (let batch = 0; batch < batches; batch++) {
        const batchPromises = [];
        
        for (let i = 0; i < batchSize; i++) {
          batchPromises.push(
            qrCodeManager.generateQRCode(`device-sustained-${batch}-${i}`, `user-sustained-${batch}-${i}`)
          );
        }

        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const totalRequests = batchSize * batches;

      expect(successful).toBeGreaterThan(totalRequests * 0.8);

      // Verify system health after sustained load
      const healthStatus = await healthCheck.getSimpleHealth();
      expect(['healthy', 'degraded']).toContain(healthStatus.status);
    });
  });

  describe('Rate Limiting Integration', () => {
    it('should enforce rate limits on QR generation', async () => {
      const userId = 'user-rate-limit';
      const deviceId = 'device-rate-limit';

      // Configure strict rate limit for testing
      rateLimiter.setConfig('qrGeneration', {
        maxRequests: 2,
        windowMs: 60000,
        algorithm: 'fixed_window' as any,
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
        headers: {
          total: true,
          remaining: true,
          reset: true,
          retryAfter: true,
        },
      });

      // First two requests should succeed
      const result1 = rateLimiter.consume('qrGeneration', userId);
      const result2 = rateLimiter.consume('qrGeneration', userId);
      
      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);

      // Third request should be rate limited
      const result3 = rateLimiter.consume('qrGeneration', userId);
      expect(result3.allowed).toBe(false);
      expect(result3.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('Health Check Integration', () => {
    it('should report system health accurately', async () => {
      const health = await healthCheck.getSystemHealth();
      
      expect(health).toBeDefined();
      expect(health.overall).toBeDefined();
      expect(health.checks).toBeDefined();
      expect(health.metrics).toBeDefined();
      
      // Verify key health checks exist
      expect(health.checks.memory).toBeDefined();
      expect(health.checks.performance).toBeDefined();
      expect(health.checks.sessions).toBeDefined();
    });

    it('should detect degraded performance', async () => {
      // Simulate high error rate
      for (let i = 0; i < 10; i++) {
        try {
          await performanceMonitor.recordOperation('test-operation', async () => {
            throw new Error('Simulated failure');
          });
        } catch (error) {
          // Expected
        }
      }

      const health = await healthCheck.getSimpleHealth();
      expect(['degraded', 'unhealthy', 'critical']).toContain(health.status);
    });
  });
});
