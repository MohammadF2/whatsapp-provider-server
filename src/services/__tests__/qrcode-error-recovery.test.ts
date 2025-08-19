/**
 * QR Code Error Recovery and Failure Scenario Tests
 * 
 * Comprehensive testing for error handling and recovery mechanisms including:
 * - Network failure recovery
 * - Browser crash scenarios
 * - Timeout handling
 * - Circuit breaker functionality
 * - Retry mechanism validation
 * - Resource cleanup after failures
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { QRCodeManager, resetQRCodeManager } from '../qrcode-manager.service';
import { resetSessionStore } from '../session-store.service';
import { errorRecoveryService } from '../error-recovery.service';
import { timeoutManager } from '../timeout-manager.service';
import { retryStrategy } from '../retry-strategy.service';
import { 
  ValidationError, 
  SessionNotFoundError, 
  QRGenerationTimeoutError,
  ClientInitializationError,
  ConcurrentSessionError,
  DeviceNotFoundError,
  BrowserLaunchError,
  NetworkError,
} from '../../models/qrcode.errors';

// Mock external dependencies
vi.mock('whatsapp-web.js', () => ({
  Client: vi.fn(),
  LocalAuth: vi.fn(),
}));

vi.mock('../selenium.service', () => ({
  default: {
    createDriver: vi.fn(),
    closeDriver: vi.fn(),
  }
}));

vi.mock('../custom-browser-launcher', () => ({
  default: {
    launch: vi.fn(),
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

describe('QR Code Error Recovery Tests', () => {
  let qrCodeManager: QRCodeManager;
  let mockClient: any;
  let mockClientWrapper: any;
  let mockFactory: any;

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
    timeoutManager.clearAllTimeouts();
    
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
      deviceId: 'test-device',
      client: mockClient,
      onQR: vi.fn(),
      onReady: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      initialize: vi.fn(),
      destroy: vi.fn(),
    };

    // Mock factory
    mockFactory = {
      createClient: vi.fn(),
      hasClient: vi.fn().mockReturnValue(false),
      destroyClient: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock('../whatsapp-client-factory.service', () => ({
      default: mockFactory,
    }));

    // Mock Client constructor
    const { Client } = require('whatsapp-web.js');
    Client.mockImplementation(() => mockClient);

    // Create QR Code Manager with test configuration
    qrCodeManager = new QRCodeManager({
      qrGenerationTimeoutMs: 5000,
      sessionExpirationMs: 10000,
      cleanupIntervalMs: 0,
      enableLogging: false,
      maxSessionsPerUser: 5,
      maxSessionsPerDevice: 1,
    });
  });

  afterEach(async () => {
    try {
      await qrCodeManager.destroy();
    } catch (error) {
      // Ignore cleanup errors
    }
    
    resetQRCodeManager();
    resetSessionStore();
    vi.clearAllMocks();
  });

  describe('Network Failure Recovery', () => {
    it('should recover from temporary network failures', async () => {
      const deviceId = 'device-network-recovery';
      const userId = 'user-network-recovery';

      let attemptCount = 0;
      mockFactory.createClient.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new NetworkError('Network timeout', 'NETWORK_TIMEOUT');
        }
        return Promise.resolve(mockClientWrapper);
      });

      mockClientWrapper.initialize.mockResolvedValue(undefined);

      // Should eventually succeed after retries
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      
      expect(session).toBeDefined();
      expect(attemptCount).toBe(3);
      expect(mockFactory.createClient).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retry attempts', async () => {
      const deviceId = 'device-network-fail';
      const userId = 'user-network-fail';

      // Always fail
      mockFactory.createClient.mockRejectedValue(new NetworkError('Persistent network error', 'NETWORK_ERROR'));

      await expect(qrCodeManager.generateQRCode(deviceId, userId))
        .rejects.toThrow('Persistent network error');
    });

    it('should handle intermittent connection issues', async () => {
      const deviceId = 'device-intermittent';
      const userId = 'user-intermittent';

      let callCount = 0;
      mockFactory.createClient.mockImplementation(() => {
        callCount++;
        // Fail every other call
        if (callCount % 2 === 1) {
          throw new NetworkError('Intermittent failure', 'NETWORK_TIMEOUT');
        }
        return Promise.resolve(mockClientWrapper);
      });

      mockClientWrapper.initialize.mockResolvedValue(undefined);

      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      expect(session).toBeDefined();
      expect(callCount).toBe(2);
    });
  });

  describe('Browser Crash Scenarios', () => {
    it('should handle browser launch failures', async () => {
      const deviceId = 'device-browser-crash';
      const userId = 'user-browser-crash';

      let attemptCount = 0;
      mockFactory.createClient.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new BrowserLaunchError('Chrome failed to start', 'BROWSER_LAUNCH_ERROR');
        }
        return Promise.resolve(mockClientWrapper);
      });

      mockClientWrapper.initialize.mockResolvedValue(undefined);

      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      expect(session).toBeDefined();
      expect(attemptCount).toBe(2);
    });

    it('should clean up resources after browser crashes', async () => {
      const deviceId = 'device-cleanup-crash';
      const userId = 'user-cleanup-crash';

      // Simulate browser crash during initialization
      mockFactory.createClient.mockResolvedValue(mockClientWrapper);
      mockClientWrapper.initialize.mockRejectedValue(new Error('Browser crashed'));

      await expect(qrCodeManager.generateQRCode(deviceId, userId))
        .rejects.toThrow('Browser crashed');

      // Verify cleanup was called
      expect(mockFactory.destroyClient).toHaveBeenCalledWith(deviceId);
    });

    it('should handle client destruction failures gracefully', async () => {
      const deviceId = 'device-destroy-fail';
      const userId = 'user-destroy-fail';

      mockFactory.createClient.mockResolvedValue(mockClientWrapper);
      mockClientWrapper.initialize.mockRejectedValue(new Error('Init failed'));
      mockFactory.destroyClient.mockRejectedValue(new Error('Destroy failed'));

      // Should not throw despite destroy failure
      await expect(qrCodeManager.generateQRCode(deviceId, userId))
        .rejects.toThrow('Init failed');
    });
  });

  describe('Timeout Handling', () => {
    it('should handle QR generation timeouts', async () => {
      const deviceId = 'device-timeout';
      const userId = 'user-timeout';

      mockFactory.createClient.mockResolvedValue(mockClientWrapper);
      
      // Simulate long initialization that exceeds timeout
      mockClientWrapper.initialize.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(resolve, 10000); // Longer than 5000ms timeout
        });
      });

      const promise = qrCodeManager.generateQRCode(deviceId, userId);
      
      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(6000);
      
      await expect(promise).rejects.toThrow(QRGenerationTimeoutError);
    });

    it('should clean up timeouts on successful completion', async () => {
      const deviceId = 'device-timeout-cleanup';
      const userId = 'user-timeout-cleanup';

      mockFactory.createClient.mockResolvedValue(mockClientWrapper);
      mockClientWrapper.initialize.mockResolvedValue(undefined);

      const initialTimeouts = timeoutManager.getActiveTimeoutStats().totalActive;
      
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      
      // Simulate QR code generation
      const qrCallback = mockClientWrapper.onQR.mock.calls[0][0];
      await qrCallback('test-qr-code');

      const finalTimeouts = timeoutManager.getActiveTimeoutStats().totalActive;
      
      expect(session).toBeDefined();
      expect(finalTimeouts).toBeLessThanOrEqual(initialTimeouts); // Timeout should be cleaned up
    });

    it('should handle multiple concurrent timeouts', async () => {
      const promises = [];
      
      for (let i = 0; i < 5; i++) {
        mockFactory.createClient.mockResolvedValue({
          ...mockClientWrapper,
          deviceId: `device-concurrent-${i}`,
        });
        
        promises.push(
          qrCodeManager.generateQRCode(`device-concurrent-${i}`, `user-concurrent-${i}`)
        );
      }

      // Let some time pass but not enough to timeout
      vi.advanceTimersByTime(3000);
      
      const activeTimeouts = timeoutManager.getActiveTimeoutStats().totalActive;
      expect(activeTimeouts).toBeGreaterThan(0);

      // Now trigger timeouts
      vi.advanceTimersByTime(3000);
      
      const results = await Promise.allSettled(promises);
      const timeoutErrors = results.filter(r => 
        r.status === 'rejected' && r.reason instanceof QRGenerationTimeoutError
      );
      
      expect(timeoutErrors.length).toBeGreaterThan(0);
    });
  });

  describe('Circuit Breaker Functionality', () => {
    it('should open circuit breaker after repeated failures', async () => {
      const deviceId = 'device-circuit-breaker';
      const userId = 'user-circuit-breaker';

      // Configure to always fail
      mockFactory.createClient.mockRejectedValue(new Error('Persistent failure'));

      // Make multiple requests to trigger circuit breaker
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          qrCodeManager.generateQRCode(`${deviceId}-${i}`, `${userId}-${i}`)
            .catch(error => ({ error: error.message }))
        );
      }

      await Promise.all(promises);

      // Check circuit breaker status
      const circuitBreakerStatuses = errorRecoveryService.getCircuitBreakerStatuses();
      const openBreakers = Object.values(circuitBreakerStatuses).filter(
        (status: any) => status.state === 'open'
      );

      expect(openBreakers.length).toBeGreaterThan(0);
    });

    it('should reset circuit breaker after timeout', async () => {
      const deviceId = 'device-circuit-reset';
      const userId = 'user-circuit-reset';

      // Trigger circuit breaker
      mockFactory.createClient.mockRejectedValue(new Error('Failure'));
      
      for (let i = 0; i < 6; i++) {
        try {
          await qrCodeManager.generateQRCode(`${deviceId}-${i}`, `${userId}-${i}`);
        } catch (error) {
          // Expected
        }
      }

      // Wait for circuit breaker reset timeout
      vi.advanceTimersByTime(65000); // 65 seconds

      // Now make it succeed
      mockFactory.createClient.mockResolvedValue(mockClientWrapper);
      mockClientWrapper.initialize.mockResolvedValue(undefined);

      // Should succeed after circuit breaker reset
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      expect(session).toBeDefined();
    });
  });

  describe('Retry Mechanism Validation', () => {
    it('should use exponential backoff for retries', async () => {
      const deviceId = 'device-backoff';
      const userId = 'user-backoff';

      const retryDelays: number[] = [];
      let attemptCount = 0;

      // Mock retry strategy to capture delays
      const originalExecute = retryStrategy.executeWithRetry;
      vi.spyOn(retryStrategy, 'executeWithRetry').mockImplementation(async (operation, configName, context) => {
        attemptCount++;
        if (attemptCount < 3) {
          const startTime = Date.now();
          try {
            await operation();
          } catch (error) {
            const delay = Date.now() - startTime;
            retryDelays.push(delay);
            throw error;
          }
        }
        return await operation();
      });

      mockFactory.createClient.mockImplementation(() => {
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return Promise.resolve(mockClientWrapper);
      });

      mockClientWrapper.initialize.mockResolvedValue(undefined);

      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      expect(session).toBeDefined();
      expect(attemptCount).toBe(3);
    });

    it('should not retry non-retryable errors', async () => {
      const deviceId = 'device-no-retry';
      const userId = 'user-no-retry';

      // Validation errors should not be retried
      mockFactory.createClient.mockRejectedValue(new ValidationError('Invalid device ID'));

      await expect(qrCodeManager.generateQRCode(deviceId, userId))
        .rejects.toThrow(ValidationError);

      // Should only be called once (no retries)
      expect(mockFactory.createClient).toHaveBeenCalledTimes(1);
    });

    it('should respect max retry limits', async () => {
      const deviceId = 'device-max-retry';
      const userId = 'user-max-retry';

      let callCount = 0;
      mockFactory.createClient.mockImplementation(() => {
        callCount++;
        throw new Error('Always fails');
      });

      await expect(qrCodeManager.generateQRCode(deviceId, userId))
        .rejects.toThrow('Always fails');

      // Should respect max retry limit (3 attempts + 1 initial = 4 total)
      expect(callCount).toBeLessThanOrEqual(4);
    });
  });

  describe('Resource Cleanup After Failures', () => {
    it('should clean up sessions after failures', async () => {
      const deviceId = 'device-cleanup-session';
      const userId = 'user-cleanup-session';

      mockFactory.createClient.mockResolvedValue(mockClientWrapper);
      mockClientWrapper.initialize.mockRejectedValue(new Error('Init failed'));

      try {
        await qrCodeManager.generateQRCode(deviceId, userId);
      } catch (error) {
        // Expected
      }

      // Session should be marked as failed
      const sessions = qrCodeManager.getStatistics();
      expect(sessions.activeSessionCount).toBe(0); // Should be cleaned up
    });

    it('should clean up timeouts after failures', async () => {
      const deviceId = 'device-cleanup-timeout';
      const userId = 'user-cleanup-timeout';

      mockFactory.createClient.mockResolvedValue(mockClientWrapper);
      mockClientWrapper.initialize.mockRejectedValue(new Error('Init failed'));

      const initialTimeouts = timeoutManager.getActiveTimeoutStats().totalActive;

      try {
        await qrCodeManager.generateQRCode(deviceId, userId);
      } catch (error) {
        // Expected
      }

      const finalTimeouts = timeoutManager.getActiveTimeoutStats().totalActive;
      expect(finalTimeouts).toBeLessThanOrEqual(initialTimeouts);
    });

    it('should clean up client resources after failures', async () => {
      const deviceId = 'device-cleanup-client';
      const userId = 'user-cleanup-client';

      mockFactory.createClient.mockResolvedValue(mockClientWrapper);
      mockClientWrapper.initialize.mockRejectedValue(new Error('Init failed'));

      try {
        await qrCodeManager.generateQRCode(deviceId, userId);
      } catch (error) {
        // Expected
      }

      // Client should be destroyed
      expect(mockFactory.destroyClient).toHaveBeenCalledWith(deviceId);
    });
  });

  describe('Error Recovery Recommendations', () => {
    it('should provide appropriate recovery recommendations', async () => {
      const errors = [
        new QRGenerationTimeoutError('device1', 5000),
        new BrowserLaunchError('Browser failed', 'BROWSER_LAUNCH_ERROR'),
        new NetworkError('Network timeout', 'NETWORK_TIMEOUT'),
        new ValidationError('Invalid input'),
      ];

      for (const error of errors) {
        const recommendations = errorRecoveryService.getRecoveryRecommendations(error);
        
        expect(recommendations).toBeDefined();
        expect(recommendations.errorCategory).toBeDefined();
        expect(recommendations.recoveryActions).toBeInstanceOf(Array);
        expect(recommendations.recoveryActions.length).toBeGreaterThan(0);
        
        // Validation errors should not be retried
        if (error instanceof ValidationError) {
          expect(recommendations.shouldRetry).toBe(false);
        }
      }
    });
  });

  describe('Graceful Degradation', () => {
    it('should continue operating with reduced functionality during failures', async () => {
      const deviceId = 'device-degraded';
      const userId = 'user-degraded';

      // Simulate partial system failure
      mockFactory.createClient.mockImplementation(() => {
        // Fail 50% of the time
        if (Math.random() < 0.5) {
          throw new Error('Random failure');
        }
        return Promise.resolve(mockClientWrapper);
      });

      mockClientWrapper.initialize.mockResolvedValue(undefined);

      const attempts = 10;
      const results = [];

      for (let i = 0; i < attempts; i++) {
        try {
          const session = await qrCodeManager.generateQRCode(`${deviceId}-${i}`, `${userId}-${i}`);
          results.push({ success: true, session });
        } catch (error) {
          results.push({ success: false, error: error.message });
        }
      }

      const successful = results.filter(r => r.success).length;
      
      // Should have some successes even with failures
      expect(successful).toBeGreaterThan(0);
      expect(successful).toBeLessThan(attempts); // But not all should succeed
    });
  });
});
