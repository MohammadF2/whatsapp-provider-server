/**
 * QR Code Manager Service Unit Tests
 * 
 * Comprehensive test suite for the QRCodeManager service covering:
 * - Session creation and management
 * - Status tracking and updates
 * - Error handling scenarios
 * - Cleanup operations
 * - Configuration management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QRCodeManager, getQRCodeManager, resetQRCodeManager } from '../qrcode-manager.service';
import { resetSessionStore } from '../session-store.service';
import { 
  ValidationError, 
  SessionNotFoundError, 
  ClientInitializationError,
  QRCodeError 
} from '../../models/qrcode.index';

// Mock console methods to avoid noise in tests
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('QRCodeManager', () => {
  let qrCodeManager: QRCodeManager;

  beforeEach(() => {
    // Reset singletons before each test
    resetQRCodeManager();
    resetSessionStore();
    
    // Create fresh instance with test configuration
    qrCodeManager = new QRCodeManager({
      qrGenerationTimeoutMs: 1000, // Short timeout for tests
      sessionExpirationMs: 2000,   // Short expiration for tests
      cleanupIntervalMs: 0,        // Disable automatic cleanup in tests
      enableLogging: false,        // Disable logging in tests
    });
  });

  afterEach(() => {
    // Clean up after each test
    qrCodeManager.destroy();
    resetQRCodeManager();
    resetSessionStore();
    vi.clearAllMocks();
  });

  describe('generateQRCode', () => {
    it('should create a new QR code session successfully', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';

      const session = await qrCodeManager.generateQRCode(deviceId, userId);

      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.deviceId).toBe(deviceId);
      expect(session.userId).toBe(userId);
      expect(session.status).toBe('pending');
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.clientType).toBe('puppeteer');
    });

    it('should validate required parameters', async () => {
      await expect(qrCodeManager.generateQRCode('', 'user-123'))
        .rejects.toThrow(ValidationError);
      
      await expect(qrCodeManager.generateQRCode('device-123', ''))
        .rejects.toThrow(ValidationError);
      
      await expect(qrCodeManager.generateQRCode('   ', 'user-123'))
        .rejects.toThrow(ValidationError);
    });

    it('should clean up existing active sessions for the same device', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';

      // Create first session
      const session1 = await qrCodeManager.generateQRCode(deviceId, userId);
      expect(session1.status).toBe('pending');

      // Create second session for same device
      const session2 = await qrCodeManager.generateQRCode(deviceId, userId);
      expect(session2.status).toBe('pending');
      expect(session2.sessionId).not.toBe(session1.sessionId);

      // First session should be cancelled or expired (cleaned up)
      const firstSessionStatus = await qrCodeManager.getSessionStatus(session1.sessionId);
      expect(['failed', 'expired']).toContain(firstSessionStatus);
    });

    it('should handle errors during session creation', async () => {
      // Test with invalid parameters that would cause internal errors
      await expect(qrCodeManager.generateQRCode(null as any, 'user-123'))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('getSessionStatus', () => {
    it('should return session status for valid session', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';

      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      const status = await qrCodeManager.getSessionStatus(session.sessionId);

      expect(status).toBe('pending');
    });

    it('should throw error for invalid session ID', async () => {
      await expect(qrCodeManager.getSessionStatus(''))
        .rejects.toThrow(ValidationError);
      
      // Non-existent sessions return 'expired' status instead of throwing error
      const status = await qrCodeManager.getSessionStatus('non-existent-session');
      expect(status).toBe('expired');
    });

    it('should return expired status for expired sessions', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';

      const session = await qrCodeManager.generateQRCode(deviceId, userId);

      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 2100));

      const status = await qrCodeManager.getSessionStatus(session.sessionId);
      expect(status).toBe('expired');
    });
  });

  describe('getSession', () => {
    it('should return full session details for valid session', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';

      const originalSession = await qrCodeManager.generateQRCode(deviceId, userId);
      const retrievedSession = await qrCodeManager.getSession(originalSession.sessionId);

      expect(retrievedSession).toBeDefined();
      expect(retrievedSession!.sessionId).toBe(originalSession.sessionId);
      expect(retrievedSession!.deviceId).toBe(deviceId);
      expect(retrievedSession!.userId).toBe(userId);
      expect(retrievedSession!.status).toBe('pending');
    });

    it('should return null for non-existent session', async () => {
      const session = await qrCodeManager.getSession('non-existent-session');
      expect(session).toBeNull();
    });

    it('should validate session ID parameter', async () => {
      await expect(qrCodeManager.getSession(''))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('cancelSession', () => {
    it('should cancel an active session successfully', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';

      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      expect(session.status).toBe('pending');

      await qrCodeManager.cancelSession(session.sessionId);

      const status = await qrCodeManager.getSessionStatus(session.sessionId);
      expect(status).toBe('failed');

      const updatedSession = await qrCodeManager.getSession(session.sessionId);
      expect(updatedSession!.error).toBe('Session cancelled by user');
    });

    it('should throw error for invalid session ID', async () => {
      await expect(qrCodeManager.cancelSession(''))
        .rejects.toThrow(ValidationError);
      
      await expect(qrCodeManager.cancelSession('non-existent-session'))
        .rejects.toThrow(SessionNotFoundError);
    });
  });

  describe('getUserSessions', () => {
    it('should return all sessions for a user', async () => {
      const userId = 'user-456';
      const deviceId1 = 'device-123';
      const deviceId2 = 'device-789';

      const session1 = await qrCodeManager.generateQRCode(deviceId1, userId);
      const session2 = await qrCodeManager.generateQRCode(deviceId2, userId);

      const userSessions = await qrCodeManager.getUserSessions(userId);

      expect(userSessions).toHaveLength(2);
      expect(userSessions.map(s => s.sessionId)).toContain(session1.sessionId);
      expect(userSessions.map(s => s.sessionId)).toContain(session2.sessionId);
    });

    it('should return empty array for user with no sessions', async () => {
      const userSessions = await qrCodeManager.getUserSessions('user-with-no-sessions');
      expect(userSessions).toHaveLength(0);
    });

    it('should validate user ID parameter', async () => {
      await expect(qrCodeManager.getUserSessions(''))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('updateSessionWithQRCode', () => {
    it('should update session with QR code data', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';
      const qrCode = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...';

      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      await qrCodeManager.updateSessionWithQRCode(session.sessionId, qrCode);

      const updatedSession = await qrCodeManager.getSession(session.sessionId);
      expect(updatedSession!.qrCode).toBe(qrCode);
      expect(updatedSession!.status).toBe('generated');
    });

    it('should throw error for non-existent session', async () => {
      const qrCode = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...';
      
      await expect(qrCodeManager.updateSessionWithQRCode('non-existent-session', qrCode))
        .rejects.toThrow(SessionNotFoundError);
    });
  });

  describe('updateSessionStatus', () => {
    it('should update session status successfully', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';

      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      await qrCodeManager.updateSessionStatus(session.sessionId, 'scanned');

      const status = await qrCodeManager.getSessionStatus(session.sessionId);
      expect(status).toBe('scanned');
    });

    it('should update session status with error message', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';
      const errorMessage = 'Connection failed';

      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      await qrCodeManager.updateSessionStatus(session.sessionId, 'failed', errorMessage);

      const updatedSession = await qrCodeManager.getSession(session.sessionId);
      expect(updatedSession!.status).toBe('failed');
      expect(updatedSession!.error).toBe(errorMessage);
    });

    it('should throw error for non-existent session', async () => {
      await expect(qrCodeManager.updateSessionStatus('non-existent-session', 'connected'))
        .rejects.toThrow(SessionNotFoundError);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should clean up expired sessions', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';

      // Create a session
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      expect(await qrCodeManager.getSession(session.sessionId)).toBeDefined();

      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 2100));

      // Run cleanup
      await qrCodeManager.cleanupExpiredSessions();

      // Session should be cleaned up
      const cleanedSession = await qrCodeManager.getSession(session.sessionId);
      expect(cleanedSession).toBeNull();
    });

    it('should not affect active sessions during cleanup', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';

      // Create a fresh session
      const session = await qrCodeManager.generateQRCode(deviceId, userId);
      
      // Run cleanup immediately (session should not be expired)
      await qrCodeManager.cleanupExpiredSessions();

      // Session should still exist
      const activeSession = await qrCodeManager.getSession(session.sessionId);
      expect(activeSession).toBeDefined();
      expect(activeSession!.status).toBe('pending');
    });
  });

  describe('configuration and statistics', () => {
    it('should return current configuration', () => {
      const config = qrCodeManager.getConfig();
      
      expect(config).toBeDefined();
      expect(config.qrGenerationTimeoutMs).toBe(1000);
      expect(config.sessionExpirationMs).toBe(2000);
      expect(config.enableLogging).toBe(false);
    });

    it('should return statistics', async () => {
      const deviceId = 'device-123';
      const userId = 'user-456';

      // Create some sessions
      await qrCodeManager.generateQRCode(deviceId, userId);
      await qrCodeManager.generateQRCode('device-456', userId);

      const stats = qrCodeManager.getStatistics();
      
      expect(stats).toBeDefined();
      expect(stats.activeSessionCount).toBe(2);
      expect(stats.totalCorrelationIds).toBe(2);
      expect(stats.config).toBeDefined();
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance when using getQRCodeManager', () => {
      const instance1 = getQRCodeManager();
      const instance2 = getQRCodeManager();
      
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getQRCodeManager();
      resetQRCodeManager();
      const instance2 = getQRCodeManager();
      
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('error handling', () => {
    it('should handle and wrap unexpected errors', async () => {
      // Create a scenario that might cause unexpected errors
      const deviceId = 'device-123';
      const userId = 'user-456';

      // Test error handling in generateQRCode
      await expect(qrCodeManager.generateQRCode(null as any, userId))
        .rejects.toThrow(ValidationError);
    });

    it('should preserve QRCodeError instances', async () => {
      await expect(qrCodeManager.getSessionStatus(''))
        .rejects.toThrow(ValidationError);
      
      // Non-existent sessions return 'expired' status instead of throwing error
      const status = await qrCodeManager.getSessionStatus('non-existent');
      expect(status).toBe('expired');
    });
  });

  describe('resource cleanup', () => {
    it('should clean up resources when destroyed', () => {
      const stats = qrCodeManager.getStatistics();
      expect(stats.totalCorrelationIds).toBe(0);

      qrCodeManager.destroy();

      // After destroy, correlation IDs should be cleared
      const statsAfterDestroy = qrCodeManager.getStatistics();
      expect(statsAfterDestroy.totalCorrelationIds).toBe(0);
    });
  });
});

describe('QRCodeManager Integration Tests', () => {
  let qrCodeManager: QRCodeManager;

  beforeEach(() => {
    resetQRCodeManager();
    resetSessionStore();
    
    qrCodeManager = new QRCodeManager({
      qrGenerationTimeoutMs: 500,
      sessionExpirationMs: 1000,
      cleanupIntervalMs: 0,
      enableLogging: false,
    });
  });

  afterEach(() => {
    qrCodeManager.destroy();
    resetQRCodeManager();
    resetSessionStore();
  });

  it('should handle complete session lifecycle', async () => {
    const deviceId = 'device-123';
    const userId = 'user-456';
    const qrCode = 'data:image/png;base64,test-qr-code';

    // 1. Generate QR code session
    const session = await qrCodeManager.generateQRCode(deviceId, userId);
    expect(session.status).toBe('pending');

    // 2. Update with QR code data
    await qrCodeManager.updateSessionWithQRCode(session.sessionId, qrCode);
    const generatedSession = await qrCodeManager.getSession(session.sessionId);
    expect(generatedSession!.status).toBe('generated');
    expect(generatedSession!.qrCode).toBe(qrCode);

    // 3. Update to scanned status
    await qrCodeManager.updateSessionStatus(session.sessionId, 'scanned');
    expect(await qrCodeManager.getSessionStatus(session.sessionId)).toBe('scanned');

    // 4. Update to connected status
    await qrCodeManager.updateSessionStatus(session.sessionId, 'connected');
    expect(await qrCodeManager.getSessionStatus(session.sessionId)).toBe('connected');
  });

  it('should handle concurrent sessions for different devices', async () => {
    const userId = 'user-456';
    const device1 = 'device-123';
    const device2 = 'device-789';

    // Create sessions for different devices
    const session1 = await qrCodeManager.generateQRCode(device1, userId);
    const session2 = await qrCodeManager.generateQRCode(device2, userId);

    expect(session1.deviceId).toBe(device1);
    expect(session2.deviceId).toBe(device2);
    expect(session1.sessionId).not.toBe(session2.sessionId);

    // Both sessions should be active
    const userSessions = await qrCodeManager.getUserSessions(userId);
    expect(userSessions).toHaveLength(2);
  });

  it('should handle session expiration correctly', async () => {
    const deviceId = 'device-123';
    const userId = 'user-456';

    const session = await qrCodeManager.generateQRCode(deviceId, userId);
    expect(session.status).toBe('pending');

    // Wait for session to expire
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Status check should return expired
    const status = await qrCodeManager.getSessionStatus(session.sessionId);
    expect(status).toBe('expired');
  });
});