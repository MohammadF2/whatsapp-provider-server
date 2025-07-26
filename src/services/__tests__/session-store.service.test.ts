/**
 * Session Store Service Unit Tests
 * 
 * Comprehensive test suite for the SessionStore service implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionStore, getSessionStore, resetSessionStore } from '../session-store.service';
import { QRCodeSession, SessionStatus } from '../../models/qrcode.index';

describe('SessionStore', () => {
  let sessionStore: SessionStore;

  beforeEach(() => {
    // Reset any existing singleton instance
    resetSessionStore();
    
    // Create a new instance with test configuration
    sessionStore = new SessionStore({
      defaultExpirationMs: 1000, // 1 second for faster tests
      cleanupIntervalMs: 500,     // 0.5 seconds for faster tests
      maxSessionsPerUser: 3,
      maxSessionsPerDevice: 1,
    });
  });

  afterEach(() => {
    sessionStore.destroy();
    resetSessionStore();
  });

  describe('createSession', () => {
    it('should create a new session with valid parameters', () => {
      const session = sessionStore.createSession('device1', 'user1', 'puppeteer');

      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.deviceId).toBe('device1');
      expect(session.userId).toBe('user1');
      expect(session.clientType).toBe('puppeteer');
      expect(session.status).toBe('pending');
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.lastUpdated).toBeInstanceOf(Date);
      expect(session.expiresAt.getTime()).toBeGreaterThan(session.createdAt.getTime());
    });

    it('should throw error for missing deviceId', () => {
      expect(() => {
        sessionStore.createSession('', 'user1', 'puppeteer');
      }).toThrow('Device ID and User ID are required');
    });

    it('should throw error for missing userId', () => {
      expect(() => {
        sessionStore.createSession('device1', '', 'puppeteer');
      }).toThrow('Device ID and User ID are required');
    });

    it('should create sessions with unique session IDs', () => {
      const session1 = sessionStore.createSession('device1', 'user1', 'puppeteer');
      const session2 = sessionStore.createSession('device2', 'user1', 'selenium');

      expect(session1.sessionId).not.toBe(session2.sessionId);
    });

    it('should enforce device session limits', () => {
      const session1 = sessionStore.createSession('device1', 'user1', 'puppeteer');
      const session2 = sessionStore.createSession('device1', 'user2', 'selenium');

      // First session should be removed due to device limit
      expect(sessionStore.getSession(session1.sessionId)).toBeNull();
      expect(sessionStore.getSession(session2.sessionId)).toBeDefined();
    });

    it('should enforce user session limits', () => {
      const sessions = [];
      
      // Create sessions up to the limit
      for (let i = 0; i < 3; i++) {
        sessions.push(sessionStore.createSession(`device${i}`, 'user1', 'puppeteer'));
      }

      // All sessions should exist
      sessions.forEach(session => {
        expect(sessionStore.getSession(session.sessionId)).toBeDefined();
      });

      // Create one more session (should remove the oldest)
      const newSession = sessionStore.createSession('device3', 'user1', 'puppeteer');

      // Oldest session should be removed
      expect(sessionStore.getSession(sessions[0].sessionId)).toBeNull();
      expect(sessionStore.getSession(newSession.sessionId)).toBeDefined();
    });
  });

  describe('getSession', () => {
    it('should return session by ID', () => {
      const createdSession = sessionStore.createSession('device1', 'user1', 'puppeteer');
      const retrievedSession = sessionStore.getSession(createdSession.sessionId);

      expect(retrievedSession).toBeDefined();
      expect(retrievedSession!.sessionId).toBe(createdSession.sessionId);
      expect(retrievedSession!.deviceId).toBe('device1');
      expect(retrievedSession!.userId).toBe('user1');
    });

    it('should return null for non-existent session', () => {
      const session = sessionStore.getSession('non-existent-id');
      expect(session).toBeNull();
    });

    it('should return null for empty session ID', () => {
      const session = sessionStore.getSession('');
      expect(session).toBeNull();
    });

    it('should return null and clean up expired session', async () => {
      const createdSession = sessionStore.createSession('device1', 'user1', 'puppeteer');
      
      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const retrievedSession = sessionStore.getSession(createdSession.sessionId);
      expect(retrievedSession).toBeNull();
    });

    it('should return a copy to prevent external mutations', () => {
      const createdSession = sessionStore.createSession('device1', 'user1', 'puppeteer');
      const retrievedSession = sessionStore.getSession(createdSession.sessionId)!;

      // Modify the retrieved session
      retrievedSession.status = 'connected';

      // Original session should remain unchanged
      const originalSession = sessionStore.getSession(createdSession.sessionId)!;
      expect(originalSession.status).toBe('pending');
    });
  });

  describe('updateSession', () => {
    it('should update session with valid data', async () => {
      const session = sessionStore.createSession('device1', 'user1', 'puppeteer');
      const qrCode = 'data:image/png;base64,test';

      // Wait a small amount to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = sessionStore.updateSession(session.sessionId, {
        status: 'generated',
        qrCode,
      });

      expect(updated).toBe(true);

      const updatedSession = sessionStore.getSession(session.sessionId)!;
      expect(updatedSession.status).toBe('generated');
      expect(updatedSession.qrCode).toBe(qrCode);
      expect(updatedSession.lastUpdated.getTime()).toBeGreaterThan(session.lastUpdated.getTime());
    });

    it('should return false for non-existent session', () => {
      const updated = sessionStore.updateSession('non-existent-id', { status: 'connected' });
      expect(updated).toBe(false);
    });

    it('should return false for empty session ID', () => {
      const updated = sessionStore.updateSession('', { status: 'connected' });
      expect(updated).toBe(false);
    });

    it('should not allow updating immutable fields', () => {
      const session = sessionStore.createSession('device1', 'user1', 'puppeteer');
      const originalSessionId = session.sessionId;
      const originalDeviceId = session.deviceId;
      const originalUserId = session.userId;
      const originalCreatedAt = session.createdAt;

      sessionStore.updateSession(session.sessionId, {
        sessionId: 'new-session-id',
        deviceId: 'new-device-id',
        userId: 'new-user-id',
        createdAt: new Date(),
        status: 'connected',
      } as any);

      const updatedSession = sessionStore.getSession(session.sessionId)!;
      expect(updatedSession.sessionId).toBe(originalSessionId);
      expect(updatedSession.deviceId).toBe(originalDeviceId);
      expect(updatedSession.userId).toBe(originalUserId);
      expect(updatedSession.createdAt).toEqual(originalCreatedAt);
      expect(updatedSession.status).toBe('connected'); // This should be updated
    });

    it('should return false and clean up expired session', async () => {
      const session = sessionStore.createSession('device1', 'user1', 'puppeteer');
      
      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const updated = sessionStore.updateSession(session.sessionId, { status: 'connected' });
      expect(updated).toBe(false);
      expect(sessionStore.getSession(session.sessionId)).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('should delete existing session', () => {
      const session = sessionStore.createSession('device1', 'user1', 'puppeteer');
      
      const deleted = sessionStore.deleteSession(session.sessionId);
      expect(deleted).toBe(true);
      expect(sessionStore.getSession(session.sessionId)).toBeNull();
    });

    it('should return false for non-existent session', () => {
      const deleted = sessionStore.deleteSession('non-existent-id');
      expect(deleted).toBe(false);
    });

    it('should return false for empty session ID', () => {
      const deleted = sessionStore.deleteSession('');
      expect(deleted).toBe(false);
    });
  });

  describe('getUserSessions', () => {
    it('should return all sessions for a user', () => {
      const session1 = sessionStore.createSession('device1', 'user1', 'puppeteer');
      const session2 = sessionStore.createSession('device2', 'user1', 'selenium');
      sessionStore.createSession('device3', 'user2', 'puppeteer'); // Different user

      const userSessions = sessionStore.getUserSessions('user1');
      
      expect(userSessions).toHaveLength(2);
      expect(userSessions.map(s => s.sessionId)).toContain(session1.sessionId);
      expect(userSessions.map(s => s.sessionId)).toContain(session2.sessionId);
    });

    it('should return empty array for user with no sessions', () => {
      const userSessions = sessionStore.getUserSessions('non-existent-user');
      expect(userSessions).toHaveLength(0);
    });

    it('should return empty array for empty user ID', () => {
      const userSessions = sessionStore.getUserSessions('');
      expect(userSessions).toHaveLength(0);
    });

    it('should clean up expired sessions and not return them', async () => {
      const session1 = sessionStore.createSession('device1', 'user1', 'puppeteer');
      const session2 = sessionStore.createSession('device2', 'user1', 'selenium');

      // Wait for sessions to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const userSessions = sessionStore.getUserSessions('user1');
      expect(userSessions).toHaveLength(0);
      
      // Sessions should be cleaned up
      expect(sessionStore.getSession(session1.sessionId)).toBeNull();
      expect(sessionStore.getSession(session2.sessionId)).toBeNull();
    });
  });

  describe('getDeviceSessions', () => {
    it('should return all sessions for a device', () => {
      const session1 = sessionStore.createSession('device1', 'user1', 'puppeteer');
      sessionStore.createSession('device2', 'user1', 'selenium'); // Different device

      const deviceSessions = sessionStore.getDeviceSessions('device1');
      
      expect(deviceSessions).toHaveLength(1);
      expect(deviceSessions[0].sessionId).toBe(session1.sessionId);
    });

    it('should return empty array for device with no sessions', () => {
      const deviceSessions = sessionStore.getDeviceSessions('non-existent-device');
      expect(deviceSessions).toHaveLength(0);
    });

    it('should return empty array for empty device ID', () => {
      const deviceSessions = sessionStore.getDeviceSessions('');
      expect(deviceSessions).toHaveLength(0);
    });
  });

  describe('getExpiredSessions', () => {
    it('should return expired sessions', async () => {
      // Create a store without automatic cleanup for this test
      const testStore = new SessionStore({
        defaultExpirationMs: 1000,
        cleanupIntervalMs: 0, // Disable automatic cleanup
      });

      const session1 = testStore.createSession('device1', 'user1', 'puppeteer');
      const session2 = testStore.createSession('device2', 'user1', 'selenium');

      // Wait for sessions to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const expiredSessions = testStore.getExpiredSessions();
      expect(expiredSessions).toHaveLength(2);
      expect(expiredSessions.map(s => s.sessionId)).toContain(session1.sessionId);
      expect(expiredSessions.map(s => s.sessionId)).toContain(session2.sessionId);

      testStore.destroy();
    });

    it('should return empty array when no sessions are expired', () => {
      sessionStore.createSession('device1', 'user1', 'puppeteer');
      sessionStore.createSession('device2', 'user1', 'selenium');

      const expiredSessions = sessionStore.getExpiredSessions();
      expect(expiredSessions).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('should clean up expired sessions and return count', async () => {
      // Create a store without automatic cleanup for this test
      const testStore = new SessionStore({
        defaultExpirationMs: 1000,
        cleanupIntervalMs: 0, // Disable automatic cleanup
      });

      const session1 = testStore.createSession('device1', 'user1', 'puppeteer');
      const session2 = testStore.createSession('device2', 'user1', 'selenium');

      // Wait for sessions to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const cleanedCount = testStore.cleanup();
      expect(cleanedCount).toBe(2);
      
      // Sessions should be removed
      expect(testStore.getSession(session1.sessionId)).toBeNull();
      expect(testStore.getSession(session2.sessionId)).toBeNull();

      testStore.destroy();
    });

    it('should return 0 when no sessions need cleanup', () => {
      sessionStore.createSession('device1', 'user1', 'puppeteer');
      sessionStore.createSession('device2', 'user1', 'selenium');

      const cleanedCount = sessionStore.cleanup();
      expect(cleanedCount).toBe(0);
    });
  });

  describe('getActiveSessionCount', () => {
    it('should return correct count of active sessions', () => {
      sessionStore.createSession('device1', 'user1', 'puppeteer');
      sessionStore.createSession('device2', 'user1', 'selenium');

      expect(sessionStore.getActiveSessionCount()).toBe(2);
    });

    it('should not count expired sessions', async () => {
      sessionStore.createSession('device1', 'user1', 'puppeteer');
      sessionStore.createSession('device2', 'user1', 'selenium');

      // Wait for sessions to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(sessionStore.getActiveSessionCount()).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all sessions', () => {
      sessionStore.createSession('device1', 'user1', 'puppeteer');
      sessionStore.createSession('device2', 'user1', 'selenium');

      expect(sessionStore.getActiveSessionCount()).toBe(2);

      sessionStore.clear();

      expect(sessionStore.getActiveSessionCount()).toBe(0);
    });
  });

  describe('extendSession', () => {
    it('should extend session expiration time', () => {
      const session = sessionStore.createSession('device1', 'user1', 'puppeteer');
      const originalExpiration = session.expiresAt.getTime();

      const extended = sessionStore.extendSession(session.sessionId, 5000);
      expect(extended).toBe(true);

      const updatedSession = sessionStore.getSession(session.sessionId)!;
      expect(updatedSession.expiresAt.getTime()).toBeGreaterThan(originalExpiration);
    });

    it('should return false for non-existent session', () => {
      const extended = sessionStore.extendSession('non-existent-id', 5000);
      expect(extended).toBe(false);
    });
  });

  describe('getSessionsByStatus', () => {
    it('should return sessions with matching status', () => {
      const session1 = sessionStore.createSession('device1', 'user1', 'puppeteer');
      const session2 = sessionStore.createSession('device2', 'user1', 'selenium');
      
      sessionStore.updateSession(session1.sessionId, { status: 'generated' });
      sessionStore.updateSession(session2.sessionId, { status: 'connected' });

      const generatedSessions = sessionStore.getSessionsByStatus('generated');
      expect(generatedSessions).toHaveLength(1);
      expect(generatedSessions[0].sessionId).toBe(session1.sessionId);

      const connectedSessions = sessionStore.getSessionsByStatus('connected');
      expect(connectedSessions).toHaveLength(1);
      expect(connectedSessions[0].sessionId).toBe(session2.sessionId);
    });

    it('should return empty array for status with no matches', () => {
      sessionStore.createSession('device1', 'user1', 'puppeteer');
      
      const expiredSessions = sessionStore.getSessionsByStatus('expired');
      expect(expiredSessions).toHaveLength(0);
    });
  });

  describe('automatic cleanup', () => {
    it('should automatically clean up expired sessions', async () => {
      const session = sessionStore.createSession('device1', 'user1', 'puppeteer');

      // Wait for session to expire and cleanup to run
      await new Promise(resolve => setTimeout(resolve, 1600));

      expect(sessionStore.getSession(session.sessionId)).toBeNull();
    });
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const store1 = getSessionStore();
      const store2 = getSessionStore();

      expect(store1).toBe(store2);
    });

    it('should reset singleton instance', () => {
      const store1 = getSessionStore();
      resetSessionStore();
      const store2 = getSessionStore();

      expect(store1).not.toBe(store2);
    });
  });

  describe('configuration', () => {
    it('should use provided configuration', () => {
      const customStore = new SessionStore({
        defaultExpirationMs: 5000,
        maxSessionsPerUser: 10,
      });

      const config = customStore.getConfig();
      expect(config.defaultExpirationMs).toBe(5000);
      expect(config.maxSessionsPerUser).toBe(10);

      customStore.destroy();
    });

    it('should merge with default configuration', () => {
      const customStore = new SessionStore({
        defaultExpirationMs: 5000,
      });

      const config = customStore.getConfig();
      expect(config.defaultExpirationMs).toBe(5000);
      expect(config.cleanupIntervalMs).toBe(30000); // Default value

      customStore.destroy();
    });
  });
});