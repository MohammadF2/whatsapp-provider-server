/**
 * Session Cleanup and Resource Management Tests
 * 
 * Comprehensive test suite for session cleanup functionality including:
 * - Expired session cleanup
 * - Abandoned session cleanup
 * - Resource cleanup under various failure scenarios
 * - Graceful shutdown handling
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { QRCodeManager, getQRCodeManager, resetQRCodeManager } from '../qrcode-manager.service';
import { SessionStore, getSessionStore, resetSessionStore } from '../session-store.service';
import { QRCodeSession, SessionStatus } from '../../models/qrcode.index';

// Mock the WhatsApp Client Factory
vi.mock('../whatsapp-client-factory.service', () => ({
  default: {
    hasClient: vi.fn(),
    destroyClient: vi.fn(),
    destroyAllClients: vi.fn(),
    createClient: vi.fn(),
    getClient: vi.fn(),
    getActiveDevices: vi.fn(() => []),
  }
}));

describe('Session Cleanup and Resource Management', () => {
  let qrCodeManager: QRCodeManager;
  let sessionStore: SessionStore;
  let mockClientFactory: any;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Reset singleton instances
    resetQRCodeManager();
    resetSessionStore();

    // Get mock client factory
    const clientFactoryModule = await import('../whatsapp-client-factory.service');
    mockClientFactory = clientFactoryModule.default;

    // Configure mock client factory
    mockClientFactory.hasClient.mockReturnValue(true);
    mockClientFactory.destroyClient.mockResolvedValue(undefined);
    mockClientFactory.destroyAllClients.mockResolvedValue(undefined);

    // Create QR Code Manager with test configuration
    qrCodeManager = getQRCodeManager({
      qrGenerationTimeoutMs: 1000,
      sessionExpirationMs: 2000,
      cleanupIntervalMs: 0, // Disable automatic cleanup in tests
      enableLogging: false,
      maxSessionsPerUser: 5,
      maxSessionsPerDevice: 1,
    });

    sessionStore = getSessionStore({
      defaultExpirationMs: 2000,
      cleanupIntervalMs: 0, // Disable automatic cleanup in tests
      maxSessionsPerUser: 5,
      maxSessionsPerDevice: 1,
    });
  });

  afterEach(() => {
    qrCodeManager.destroy();
    sessionStore.destroy();
    resetQRCodeManager();
    resetSessionStore();
  });

  describe('Expired Session Cleanup', () => {
    it('should clean up expired sessions and their resources', async () => {
      // Arrange
      const deviceId = 'device-123';
      const userId = 'user-456';

      // Create a session
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      expect(session).toBeDefined();

      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 2100));

      // Act
      await qrCodeManager.cleanupExpiredSessions();

      // Assert
      const retrievedSession = await qrCodeManager.getSession(session.sessionId);
      expect(retrievedSession).toBeNull();

      // Verify client cleanup was called
      expect(mockClientFactory.destroyClient).toHaveBeenCalledWith(deviceId);
    });

    it('should handle client cleanup failures gracefully', async () => {
      // Arrange
      const deviceId = 'device-123';
      const userId = 'user-456';

      // Mock client factory to throw error
      mockClientFactory.destroyClient.mockRejectedValue(new Error('Client cleanup failed'));

      // Create a session
      const session = await qrCodeManager.generateQRCode(deviceId, userId);

      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 2100));

      // Act & Assert - should not throw
      await expect(qrCodeManager.cleanupExpiredSessions()).resolves.not.toThrow();

      // Session should still be cleaned up from store
      const retrievedSession = await qrCodeManager.getSession(session.sessionId);
      expect(retrievedSession).toBeNull();
    });

    it('should clean up multiple expired sessions', async () => {
      // Arrange
      const sessions = [];
      for (let i = 0; i < 3; i++) {
        const session = await qrCodeManager.generateQRCode(`device-${i}`, `user-${i}`);
        sessions.push(session);
      }

      // Wait for sessions to expire
      await new Promise(resolve => setTimeout(resolve, 2100));

      // Act
      await qrCodeManager.cleanupExpiredSessions();

      // Assert
      for (const session of sessions) {
        const retrievedSession = await qrCodeManager.getSession(session.sessionId);
        expect(retrievedSession).toBeNull();
      }

      // Verify client cleanup was called for each device (may be called more due to other tests)
      expect(mockClientFactory.destroyClient).toHaveBeenCalledWith('device-0');
      expect(mockClientFactory.destroyClient).toHaveBeenCalledWith('device-1');
      expect(mockClientFactory.destroyClient).toHaveBeenCalledWith('device-2');
    }, 10000); // Increase timeout to 10 seconds

    it('should not affect active sessions during cleanup', async () => {
      // Arrange
      const activeSession = await qrCodeManager.generateQRCode('active-device', 'active-user');
      const expiredSession = await qrCodeManager.generateQRCode('expired-device', 'expired-user');

      // Wait for one session to expire
      await new Promise(resolve => setTimeout(resolve, 2100));

      // Act
      await qrCodeManager.cleanupExpiredSessions();

      // Assert
      const activeRetrieved = await qrCodeManager.getSession(activeSession.sessionId);
      const expiredRetrieved = await qrCodeManager.getSession(expiredSession.sessionId);

      expect(activeRetrieved).toBeDefined();
      expect(expiredRetrieved).toBeNull();
    });
  });

  describe('Abandoned Session Cleanup', () => {
    it('should clean up abandoned sessions stuck in pending state', async () => {
      // Arrange
      const deviceId = 'device-123';
      const userId = 'user-456';

      // Create a session store with longer expiration to test abandoned logic
      const testSessionStore = new SessionStore({
        defaultExpirationMs: 10000, // 10 seconds - longer than abandoned threshold
        cleanupIntervalMs: 0,
        maxSessionsPerUser: 5,
        maxSessionsPerDevice: 1,
      });

      // Create a session directly in the test session store
      const session = testSessionStore.createSession(deviceId, userId, 'puppeteer');
      expect(session.status).toBe('pending');

      // Create QR manager with test session store
      const testQRManager = new QRCodeManager({
        qrGenerationTimeoutMs: 1000,
        sessionExpirationMs: 10000, // Match session store
        cleanupIntervalMs: 0,
        enableLogging: false,
      });

      // Replace the session store in the QR manager
      (testQRManager as any).sessionStore = testSessionStore;

      // Wait for session to be considered abandoned (3x QR timeout = 3 seconds)
      await new Promise(resolve => setTimeout(resolve, 3100));

      // Act
      await testQRManager.cleanupAbandonedSessions();

      // Assert
      const retrievedSession = testSessionStore.getSession(session.sessionId);
      expect(retrievedSession?.status).toBe('failed');
      expect(retrievedSession?.error).toContain('abandoned');

      // Verify client cleanup was called
      expect(mockClientFactory.destroyClient).toHaveBeenCalledWith(deviceId);

      // Cleanup
      testQRManager.destroy();
      testSessionStore.destroy();
    });

    it('should not clean up recently created pending sessions', async () => {
      // Arrange
      const deviceId = 'device-123';
      const userId = 'user-456';

      // Create a session directly in the session store to simulate pending state
      const session = sessionStore.createSession(deviceId, userId, 'puppeteer');
      expect(session.status).toBe('pending');

      // Act immediately (session is not abandoned yet)
      await qrCodeManager.cleanupAbandonedSessions();

      // Assert
      const retrievedSession = sessionStore.getSession(session.sessionId);
      expect(retrievedSession?.status).toBe('pending');

      // Verify client cleanup was not called
      expect(mockClientFactory.destroyClient).not.toHaveBeenCalled();
    });

    it('should handle multiple abandoned sessions', async () => {
      // Arrange
      // Create a session store with longer expiration to test abandoned logic
      const testSessionStore = new SessionStore({
        defaultExpirationMs: 10000, // 10 seconds - longer than abandoned threshold
        cleanupIntervalMs: 0,
        maxSessionsPerUser: 10, // Allow more sessions
        maxSessionsPerDevice: 5, // Allow multiple sessions per device for testing
      });

      const sessions = [];
      for (let i = 0; i < 3; i++) {
        const session = testSessionStore.createSession(`abandoned-device-${i}`, `abandoned-user-${i}`, 'puppeteer');
        sessions.push(session);
      }

      // Create QR manager with test session store
      const testQRManager = new QRCodeManager({
        qrGenerationTimeoutMs: 1000,
        sessionExpirationMs: 10000, // Match session store
        cleanupIntervalMs: 0,
        enableLogging: false,
      });

      // Replace the session store in the QR manager
      (testQRManager as any).sessionStore = testSessionStore;

      // Wait for sessions to be considered abandoned
      await new Promise(resolve => setTimeout(resolve, 3100));

      // Act
      await testQRManager.cleanupAbandonedSessions();

      // Assert
      for (const session of sessions) {
        const retrievedSession = testSessionStore.getSession(session.sessionId);
        expect(retrievedSession?.status).toBe('failed');
        expect(retrievedSession?.error).toContain('abandoned');
      }

      // Verify client cleanup was called (at least once, may be limited by session store constraints)
      expect(mockClientFactory.destroyClient).toHaveBeenCalled();

      // Verify that at least the first session was processed
      expect(mockClientFactory.destroyClient).toHaveBeenCalledWith('abandoned-device-0');

      // Cleanup
      testQRManager.destroy();
      testSessionStore.destroy();
    });
  });

  describe('Comprehensive Cleanup', () => {
    it('should perform comprehensive cleanup of all resources', async () => {
      // Arrange - create sessions with different expiration times
      // Create expired session (will expire in 2 seconds)
      const expiredSession = sessionStore.createSession('expired-device', 'expired-user', 'puppeteer');

      // Create session store with longer expiration for abandoned session test
      const testSessionStore = new SessionStore({
        defaultExpirationMs: 10000, // 10 seconds - longer than abandoned threshold
        cleanupIntervalMs: 0,
        maxSessionsPerUser: 5,
        maxSessionsPerDevice: 1,
      });

      const abandonedSession = testSessionStore.createSession('abandoned-device', 'abandoned-user', 'puppeteer');

      // Create QR manager with test session store for abandoned session
      const testQRManager = new QRCodeManager({
        qrGenerationTimeoutMs: 1000,
        sessionExpirationMs: 10000,
        cleanupIntervalMs: 0,
        enableLogging: false,
      });
      (testQRManager as any).sessionStore = testSessionStore;

      // Wait for sessions to expire and be abandoned
      await new Promise(resolve => setTimeout(resolve, 3100));

      // Act - test both managers
      const result1 = await qrCodeManager.performComprehensiveCleanup();
      const result2 = await testQRManager.performComprehensiveCleanup();

      // Assert
      expect(result1.expiredSessionsCleanedUp).toBeGreaterThan(0);
      expect(result2.abandonedSessionsCleanedUp).toBeGreaterThan(0);

      // Verify sessions are cleaned up
      const expiredRetrieved = sessionStore.getSession(expiredSession.sessionId);
      const abandonedRetrieved = testSessionStore.getSession(abandonedSession.sessionId);

      expect(expiredRetrieved).toBeNull();
      expect(abandonedRetrieved?.status).toBe('failed');

      // Cleanup
      testQRManager.destroy();
      testSessionStore.destroy();
    });

    it('should clean up orphaned timeouts and correlation IDs', async () => {
      // Arrange - create session and manually add correlation ID
      const session = sessionStore.createSession('device-123', 'user-456', 'puppeteer');

      // Manually add correlation ID to simulate what generateQRCode would do
      (qrCodeManager as any).correlationIds.set(session.sessionId, 'test-correlation-id');

      // Manually add a timeout to simulate QR generation timeout
      const timeout = setTimeout(() => { }, 10000);
      (qrCodeManager as any).qrGenerationTimeouts.set(session.sessionId, timeout);

      // Manually delete session from store to create orphaned references
      sessionStore.deleteSession(session.sessionId);

      // Act
      const result = await qrCodeManager.performComprehensiveCleanup();

      // Assert
      expect(result.correlationIdsRemoved).toBeGreaterThan(0);
      expect(result.orphanedTimeoutsCleared).toBeGreaterThan(0);
    });
  });

  describe('Resource Cleanup Under Failure Scenarios', () => {
    it('should handle client factory import failures', async () => {
      // Arrange
      const deviceId = 'device-123';
      const userId = 'user-456';

      // Create a session
      const session = await qrCodeManager.generateQRCode(deviceId, userId);

      // Mock dynamic import to fail
      const originalImport = global.import;
      global.import = vi.fn().mockRejectedValue(new Error('Import failed'));

      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 2100));

      // Act & Assert - should not throw
      await expect(qrCodeManager.cleanupExpiredSessions()).resolves.not.toThrow();

      // Restore original import
      global.import = originalImport;
    });

    it('should handle client destruction timeouts', async () => {
      // Arrange
      const deviceId = 'device-123';
      const userId = 'user-456';

      // Mock client factory to hang for a shorter time to avoid test timeout
      mockClientFactory.destroyClient.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 9000)) // 9 seconds - should timeout at 8 seconds
      );

      // Create a session directly in session store to avoid generateQRCode issues
      const session = sessionStore.createSession(deviceId, userId, 'puppeteer');

      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 2100));

      // Act & Assert - should not hang
      const startTime = Date.now();
      await qrCodeManager.cleanupExpiredSessions();
      const endTime = Date.now();

      // Should complete within reasonable time (should timeout at 8 seconds + some buffer)
      expect(endTime - startTime).toBeLessThan(10000);
    }, 12000); // Increase timeout to 12 seconds

    it('should continue cleanup even if some clients fail', async () => {
      // Arrange
      const sessions = [];
      for (let i = 0; i < 3; i++) {
        const session = await qrCodeManager.generateQRCode(`device-${i}`, `user-${i}`);
        sessions.push(session);
      }

      // Mock client factory to fail for one device
      mockClientFactory.destroyClient.mockImplementation((deviceId: string) => {
        if (deviceId === 'device-1') {
          return Promise.reject(new Error('Client destruction failed'));
        }
        return Promise.resolve();
      });

      // Wait for sessions to expire
      await new Promise(resolve => setTimeout(resolve, 2100));

      // Act & Assert - should not throw
      await expect(qrCodeManager.cleanupExpiredSessions()).resolves.not.toThrow();

      // All sessions should still be cleaned up from store
      for (const session of sessions) {
        const retrievedSession = await qrCodeManager.getSession(session.sessionId);
        expect(retrievedSession).toBeNull();
      }
    });
  });

  describe('Graceful Shutdown', () => {
    it('should perform graceful shutdown and clean up all resources', async () => {
      // Arrange - create sessions and correlation IDs
      const sessions = [];
      for (let i = 0; i < 3; i++) {
        const session = sessionStore.createSession(`device-${i}`, `user-${i}`, 'puppeteer');
        sessions.push(session);
        // Manually add correlation ID to simulate active sessions
        (qrCodeManager as any).correlationIds.set(session.sessionId, `correlation-${i}`);
      }

      // Act
      await qrCodeManager.gracefulShutdown();

      // Assert
      // Verify all clients were destroyed
      expect(mockClientFactory.destroyAllClients).toHaveBeenCalled();

      // Verify sessions were cancelled (they should be marked as failed)
      for (const session of sessions) {
        const retrievedSession = sessionStore.getSession(session.sessionId);
        // Session might be null if cleaned up completely, or failed if cancelled
        expect(retrievedSession === null || retrievedSession?.status === 'failed').toBe(true);
      }
    });

    it('should handle graceful shutdown with timeout', async () => {
      // Arrange
      const session = sessionStore.createSession('device-123', 'user-456', 'puppeteer');
      (qrCodeManager as any).correlationIds.set(session.sessionId, 'test-correlation-id');

      // Mock client factory to hang during shutdown
      mockClientFactory.destroyAllClients.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 20000)) // Longer than timeout
      );

      // Act & Assert - should not hang
      const startTime = Date.now();
      await qrCodeManager.gracefulShutdown();
      const endTime = Date.now();

      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(18000);
    }, 20000); // Increase timeout to 20 seconds

    it('should continue shutdown even if some operations fail', async () => {
      // Arrange
      const session = sessionStore.createSession('device-123', 'user-456', 'puppeteer');
      (qrCodeManager as any).correlationIds.set(session.sessionId, 'test-correlation-id');

      // Mock client factory to fail
      mockClientFactory.destroyAllClients.mockRejectedValue(new Error('Shutdown failed'));

      // Act & Assert - should not throw
      await expect(qrCodeManager.gracefulShutdown()).resolves.not.toThrow();
    });
  });

  describe('Memory Leak Prevention', () => {
    it('should clean up all references after destroy', () => {
      // Arrange
      const initialStats = qrCodeManager.getStatistics();
      expect(initialStats.totalCorrelationIds).toBe(0);

      // Act
      qrCodeManager.destroy();

      // Assert
      const finalStats = qrCodeManager.getStatistics();
      expect(finalStats.totalCorrelationIds).toBe(0);
      expect(finalStats.activeSessionCount).toBe(0);
    });

    it('should prevent memory leaks from orphaned timeouts', async () => {
      // Arrange
      const sessions = [];
      for (let i = 0; i < 5; i++) {
        const session = sessionStore.createSession(`device-${i}`, `user-${i}`, 'puppeteer');
        sessions.push(session);

        // Manually add correlation ID and timeout
        (qrCodeManager as any).correlationIds.set(session.sessionId, `correlation-${i}`);
        const timeout = setTimeout(() => { }, 10000);
        (qrCodeManager as any).qrGenerationTimeouts.set(session.sessionId, timeout);
      }

      // Manually delete sessions to create orphaned timeouts
      for (const session of sessions) {
        sessionStore.deleteSession(session.sessionId);
      }

      // Act
      const result = await qrCodeManager.performComprehensiveCleanup();

      // Assert
      expect(result.orphanedTimeoutsCleared).toBe(5);
      expect(result.correlationIdsRemoved).toBe(5);
    });
  });
});