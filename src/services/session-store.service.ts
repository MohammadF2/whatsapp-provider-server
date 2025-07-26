/**
 * Session Store Service Implementation
 * 
 * In-memory store for active QR code sessions with automatic cleanup.
 * Provides thread-safe operations and proper resource management.
 */

import { v4 as uuidv4 } from 'uuid';
import { QRCodeSession, SessionStatus, ISessionStore } from '../models/qrcode.index';

/**
 * Configuration options for the Session Store
 */
export interface SessionStoreConfig {
  /** Default session expiration time in milliseconds (default: 60000ms = 1 minute) */
  defaultExpirationMs: number;

  /** Cleanup interval in milliseconds (default: 30000ms = 30 seconds) */
  cleanupIntervalMs: number;

  /** Maximum number of sessions per user (default: 5) */
  maxSessionsPerUser: number;

  /** Maximum number of sessions per device (default: 1) */
  maxSessionsPerDevice: number;

  /** Maximum total sessions allowed (default: 1000) */
  maxTotalSessions: number;

  /** Memory optimization: compress QR codes (default: true) */
  compressQRCodes: boolean;

  /** Memory optimization: maximum QR code size in bytes (default: 10KB) */
  maxQRCodeSize: number;

  /** Memory optimization: cleanup aggressive mode threshold (default: 0.8) */
  aggressiveCleanupThreshold: number;
}

/**
 * Default configuration for the Session Store
 */
const DEFAULT_CONFIG: SessionStoreConfig = {
  defaultExpirationMs: 60 * 1000, // 1 minute
  cleanupIntervalMs: 30 * 1000,   // 30 seconds
  maxSessionsPerUser: 5,
  maxSessionsPerDevice: 1,
  maxTotalSessions: 1000,
  compressQRCodes: true,
  maxQRCodeSize: 10 * 1024, // 10KB
  aggressiveCleanupThreshold: 0.8, // 80%
};

/**
 * Thread-safe in-memory session store implementation
 */
export class SessionStore implements ISessionStore {
  private sessions: Map<string, QRCodeSession> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly config: SessionStoreConfig;
  private readonly locks: Map<string, Promise<void>> = new Map();

  constructor(config: Partial<SessionStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
  }

  /**
   * Create a new QR code session
   */
  createSession(deviceId: string, userId: string, clientType: 'puppeteer' | 'selenium'): QRCodeSession {
    if (!deviceId || !userId) {
      throw new Error('Device ID and User ID are required');
    }

    // Check device session limits
    const deviceSessions = this.getDeviceSessions(deviceId);
    if (deviceSessions.length >= this.config.maxSessionsPerDevice) {
      // Clean up existing device sessions
      deviceSessions.forEach(session => {
        this.deleteSession(session.sessionId);
      });
    }

    // Check user session limits
    const userSessions = this.getUserSessions(userId);
    if (userSessions.length >= this.config.maxSessionsPerUser) {
      // Remove oldest session
      const oldestSession = userSessions
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      this.deleteSession(oldestSession.sessionId);
    }

    const now = new Date();
    const session: QRCodeSession = {
      sessionId: uuidv4(),
      deviceId,
      userId,
      status: 'pending' as SessionStatus,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.defaultExpirationMs),
      lastUpdated: now,
      clientType,
    };

    this.sessions.set(session.sessionId, session);
    return { ...session }; // Return a copy to prevent external mutations
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): QRCodeSession | null {
    if (!sessionId) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    // Check if session is expired
    if (this.isSessionExpired(session)) {
      this.deleteSession(sessionId);
      return null;
    }

    return { ...session }; // Return a copy to prevent external mutations
  }

  /**
   * Update a session with partial data
   */
  updateSession(sessionId: string, updates: Partial<QRCodeSession>): boolean {
    if (!sessionId) {
      return false;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Check if session is expired
    if (this.isSessionExpired(session)) {
      this.deleteSession(sessionId);
      return false;
    }

    // Prevent updating immutable fields
    const { sessionId: _, deviceId: __, userId: ___, createdAt: ____, ...allowedUpdates } = updates;

    // Update the session
    const updatedSession: QRCodeSession = {
      ...session,
      ...allowedUpdates,
      lastUpdated: new Date(),
    };

    this.sessions.set(sessionId, updatedSession);
    return true;
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    if (!sessionId) {
      return false;
    }

    return this.sessions.delete(sessionId);
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): QRCodeSession[] {
    if (!userId) {
      return [];
    }

    const userSessions: QRCodeSession[] = [];
    
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        if (this.isSessionExpired(session)) {
          this.deleteSession(session.sessionId);
        } else {
          userSessions.push({ ...session }); // Return copies
        }
      }
    }

    return userSessions;
  }

  /**
   * Get all sessions for a device
   */
  getDeviceSessions(deviceId: string): QRCodeSession[] {
    if (!deviceId) {
      return [];
    }

    const deviceSessions: QRCodeSession[] = [];
    
    for (const session of this.sessions.values()) {
      if (session.deviceId === deviceId) {
        if (this.isSessionExpired(session)) {
          this.deleteSession(session.sessionId);
        } else {
          deviceSessions.push({ ...session }); // Return copies
        }
      }
    }

    return deviceSessions;
  }

  /**
   * Get all expired sessions
   */
  getExpiredSessions(): QRCodeSession[] {
    const expiredSessions: QRCodeSession[] = [];
    
    for (const session of this.sessions.values()) {
      if (this.isSessionExpired(session)) {
        expiredSessions.push({ ...session }); // Return copies
      }
    }

    return expiredSessions;
  }

  /**
   * Clean up expired sessions
   */
  cleanup(): number {
    let cleanedCount = 0;
    const expiredSessionIds: string[] = [];

    // Collect expired session IDs
    for (const session of this.sessions.values()) {
      if (this.isSessionExpired(session)) {
        expiredSessionIds.push(session.sessionId);
      }
    }

    // Delete expired sessions
    for (const sessionId of expiredSessionIds) {
      if (this.deleteSession(sessionId)) {
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Get total number of active sessions
   */
  getActiveSessionCount(): number {
    // Clean up expired sessions first
    this.cleanup();
    return this.sessions.size;
  }

  /**
   * Clear all sessions (for testing/cleanup)
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Stop the cleanup timer and clean up resources
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }

  /**
   * Get current configuration
   */
  getConfig(): SessionStoreConfig {
    return { ...this.config };
  }

  /**
   * Update session expiration time
   */
  extendSession(sessionId: string, additionalMs: number = this.config.defaultExpirationMs): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const newExpirationTime = new Date(Date.now() + additionalMs);
    return this.updateSession(sessionId, { expiresAt: newExpirationTime });
  }

  /**
   * Get sessions by status
   */
  getSessionsByStatus(status: SessionStatus): QRCodeSession[] {
    const matchingSessions: QRCodeSession[] = [];
    
    for (const session of this.sessions.values()) {
      if (this.isSessionExpired(session)) {
        this.deleteSession(session.sessionId);
      } else if (session.status === status) {
        matchingSessions.push({ ...session }); // Return copies
      }
    }

    return matchingSessions;
  }

  /**
   * Check if a session is expired
   */
  private isSessionExpired(session: QRCodeSession): boolean {
    return session.expiresAt.getTime() < Date.now();
  }

  /**
   * Start the automatic cleanup timer
   */
  private startCleanupTimer(): void {
    // Don't start timer if cleanup interval is 0 (for testing)
    if (this.config.cleanupIntervalMs <= 0) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);

    // Ensure the timer doesn't keep the process alive
    this.cleanupTimer.unref();
  }

  /**
   * Stop the automatic cleanup timer
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): {
    totalSessions: number;
    memoryUsage: number;
    averageSessionSize: number;
    largestSession: number;
    qrCodeMemoryUsage: number;
  } {
    let totalMemory = 0;
    let qrCodeMemory = 0;
    let largestSession = 0;

    for (const session of this.sessions.values()) {
      const sessionSize = this.calculateSessionSize(session);
      totalMemory += sessionSize;

      if (sessionSize > largestSession) {
        largestSession = sessionSize;
      }

      if (session.qrCode) {
        qrCodeMemory += session.qrCode.length * 2; // Approximate UTF-16 size
      }
    }

    return {
      totalSessions: this.sessions.size,
      memoryUsage: totalMemory,
      averageSessionSize: this.sessions.size > 0 ? totalMemory / this.sessions.size : 0,
      largestSession,
      qrCodeMemoryUsage: qrCodeMemory,
    };
  }

  /**
   * Optimize memory usage by cleaning up old sessions and compressing data
   */
  optimizeMemory(): {
    sessionsRemoved: number;
    memoryFreed: number;
    qrCodesCompressed: number;
  } {
    const initialMemory = this.getMemoryStats().memoryUsage;
    let sessionsRemoved = 0;
    let qrCodesCompressed = 0;

    // Check if we need aggressive cleanup
    const memoryStats = this.getMemoryStats();
    const memoryUsageRatio = memoryStats.totalSessions / this.config.maxTotalSessions;
    const needsAggressiveCleanup = memoryUsageRatio > this.config.aggressiveCleanupThreshold;

    if (needsAggressiveCleanup) {
      // Remove oldest sessions that are not active
      const sortedSessions = Array.from(this.sessions.entries())
        .filter(([_, session]) => session.status !== 'pending' && session.status !== 'generated')
        .sort(([_, a], [__, b]) => a.createdAt.getTime() - b.createdAt.getTime());

      const sessionsToRemove = Math.floor(sortedSessions.length * 0.2); // Remove 20% of inactive sessions

      for (let i = 0; i < sessionsToRemove && i < sortedSessions.length; i++) {
        const [sessionId] = sortedSessions[i];
        this.sessions.delete(sessionId);
        sessionsRemoved++;
      }
    }

    // Compress QR codes if enabled
    if (this.config.compressQRCodes) {
      for (const session of this.sessions.values()) {
        if (session.qrCode && session.qrCode.length > this.config.maxQRCodeSize) {
          // Simple compression: remove data URL prefix if present and compress
          if (session.qrCode.startsWith('data:image/')) {
            const base64Index = session.qrCode.indexOf(',');
            if (base64Index !== -1) {
              session.qrCode = session.qrCode.substring(base64Index + 1);
              qrCodesCompressed++;
            }
          }
        }
      }
    }

    const finalMemory = this.getMemoryStats().memoryUsage;
    const memoryFreed = Math.max(0, initialMemory - finalMemory);

    return {
      sessionsRemoved,
      memoryFreed,
      qrCodesCompressed,
    };
  }

  /**
   * Calculate approximate memory size of a session
   */
  private calculateSessionSize(session: QRCodeSession): number {
    let size = 0;

    // String properties
    size += (session.sessionId?.length || 0) * 2;
    size += (session.deviceId?.length || 0) * 2;
    size += (session.userId?.length || 0) * 2;
    size += (session.qrCode?.length || 0) * 2;
    size += (session.error?.length || 0) * 2;
    size += (session.clientType?.length || 0) * 2;

    // Date objects (approximate)
    size += 24; // createdAt
    size += 24; // expiresAt
    if (session.lastUpdated) size += 24;

    // Status enum (approximate)
    size += 20;

    // Additional overhead for object structure
    size += 100;

    return size;
  }

  /**
   * Get session statistics
   */
  getStatistics() {
    const allSessions = Array.from(this.sessions.values());
    const activeSessions = allSessions.filter(s =>
      s.status !== 'expired' && s.status !== 'failed' && s.status !== 'connected'
    );
    const expiredSessions = allSessions.filter(s => s.status === 'expired');
    const failedSessions = allSessions.filter(s => s.status === 'failed');
    const connectedSessions = allSessions.filter(s => s.status === 'connected');

    return {
      totalSessions: allSessions.length,
      activeSessions: activeSessions.length,
      expiredSessions: expiredSessions.length,
      failedSessions: failedSessions.length,
      connectedSessions: connectedSessions.length,
      memoryUsage: this.getMemoryStats().memoryUsage,
    };
  }
}

/**
 * Singleton instance of the Session Store
 */
let sessionStoreInstance: SessionStore | null = null;

/**
 * Get the singleton Session Store instance
 */
export function getSessionStore(config?: Partial<SessionStoreConfig>): SessionStore {
  if (!sessionStoreInstance) {
    sessionStoreInstance = new SessionStore(config);
  }
  return sessionStoreInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetSessionStore(): void {
  if (sessionStoreInstance) {
    sessionStoreInstance.destroy();
    sessionStoreInstance = null;
  }
}