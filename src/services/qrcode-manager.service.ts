/**
 * QR Code Manager Service Implementation
 * 
 * Central service for managing QR code generation sessions and WhatsApp client lifecycle.
 * Provides session creation, status tracking, error handling, and cleanup operations.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  IQRCodeManager,
  QRCodeSession,
  SessionStatus,
  QRCodeError,
  ValidationError,
  SessionNotFoundError,
  SessionExpiredError,
  QRGenerationTimeoutError,
  ClientInitializationError,
  ConcurrentSessionError
} from '../models/qrcode.index';
import { LogLevel } from './logger.service';
import { getSessionStore, SessionStore } from './session-store.service';
import { createLogger, generateCorrelationId, Logger } from './logger.service';
import { errorRecoveryService } from './error-recovery.service';
import { performanceMonitor } from './performance-monitor.service';
import { timeoutManager } from './timeout-manager.service';
import { retryStrategy } from './retry-strategy.service';

/**
 * Configuration options for the QR Code Manager
 */
export interface QRCodeManagerConfig {
  /** Default QR generation timeout in milliseconds (default: 30000ms = 30 seconds) */
  qrGenerationTimeoutMs: number;
  
  /** Default session expiration time in milliseconds (default: 60000ms = 1 minute) */
  sessionExpirationMs: number;
  
  /** Maximum concurrent sessions per user (default: 5) */
  maxSessionsPerUser: number;
  
  /** Maximum concurrent sessions per device (default: 1) */
  maxSessionsPerDevice: number;
  
  /** Cleanup interval in milliseconds (default: 30000ms = 30 seconds) */
  cleanupIntervalMs: number;
  
  /** Enable detailed logging (default: true) */
  enableLogging: boolean;
  
  /** Default client type to use (default: 'puppeteer') */
  defaultClientType: 'puppeteer' | 'selenium';
}

/**
 * Default configuration for the QR Code Manager
 */
const DEFAULT_CONFIG: QRCodeManagerConfig = {
  qrGenerationTimeoutMs: 30 * 1000,    // 30 seconds
  sessionExpirationMs: 60 * 1000,      // 1 minute
  maxSessionsPerUser: 5,
  maxSessionsPerDevice: 1,
  cleanupIntervalMs: 30 * 1000,        // 30 seconds
  enableLogging: true,
  defaultClientType: 'puppeteer',
};

/**
 * QR Code Manager Service Implementation
 * 
 * This service manages the complete lifecycle of QR code sessions including:
 * - Session creation and tracking
 * - QR code generation coordination
 * - Status monitoring and updates
 * - Automatic cleanup of expired sessions
 * - Error handling and logging
 */
export class QRCodeManager implements IQRCodeManager {
  private readonly config: QRCodeManagerConfig;
  private readonly sessionStore: SessionStore;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly correlationIds: Map<string, string> = new Map();
  private qrGenerationTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly logger: Logger;

  constructor(config: Partial<QRCodeManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('QRCodeManager', {
      level: this.config.enableLogging ? LogLevel.DEBUG : LogLevel.INFO,
      enablePerformanceLogs: true,
    });

    this.sessionStore = getSessionStore({
      defaultExpirationMs: this.config.sessionExpirationMs,
      cleanupIntervalMs: this.config.cleanupIntervalMs,
      maxSessionsPerUser: this.config.maxSessionsPerUser,
      maxSessionsPerDevice: this.config.maxSessionsPerDevice,
    });

    this.startCleanupTimer();
    this.logger.info('QRCodeManager initialized', { config: this.config });
  }

  /**
   * Generate a QR code for device authentication
   */
  async generateQRCode(deviceId: string, userId: string): Promise<QRCodeSession> {
    const correlationId = generateCorrelationId();
    const contextLogger = this.logger.child(correlationId, { deviceId, userId, operation: 'generateQRCode' });

    return await performanceMonitor.recordOperation('qr-code-generation', async () => {
      return await errorRecoveryService.executeWithFullRecovery(async () => {
        contextLogger.info('Starting QR code generation');

    try {
      // Validate input parameters
      this.validateGenerateQRCodeParams(deviceId, userId);

      // Check for existing active sessions for this device
      const existingSessions = this.sessionStore.getDeviceSessions(deviceId);
      const activeSessions = existingSessions.filter(s => 
        s.status !== 'expired' && s.status !== 'failed' && s.status !== 'connected'
      );

      if (activeSessions.length > 0) {
        contextLogger.warn('Found existing active sessions for device, cleaning up', {
          existingSessionCount: activeSessions.length,
          existingSessionIds: activeSessions.map(s => s.sessionId),
        });

        // Clean up existing sessions for this device
        for (const session of activeSessions) {
          await this.cancelSession(session.sessionId);
        }
      }

      // Check user session limits
      const userSessions = this.sessionStore.getUserSessions(userId);
      const activeUserSessions = userSessions.filter(s => 
        s.status !== 'expired' && s.status !== 'failed' && s.status !== 'connected'
      );

      if (activeUserSessions.length >= this.config.maxSessionsPerUser) {
        contextLogger.warn('User has too many active sessions', {
          activeCount: activeUserSessions.length,
          maxAllowed: this.config.maxSessionsPerUser,
        });

        throw new ConcurrentSessionError(
          `User ${userId} has reached maximum concurrent sessions (${this.config.maxSessionsPerUser})`
        );
      }

      // Create new session
      const session = this.sessionStore.createSession(
        deviceId, 
        userId, 
        this.config.defaultClientType
      );

      this.correlationIds.set(session.sessionId, correlationId);

      contextLogger.info('QR code session created', {
        sessionId: session.sessionId,
      });

      // Start QR code generation process with error handling
      try {
        await this.initiateQRCodeGeneration(session);
      } catch (initError) {
        contextLogger.error('Failed to initiate QR code generation', initError as Error, {
          sessionId: session.sessionId,
        });

        // Update session status to failed
        await this.updateSessionStatus(
          session.sessionId,
          'failed',
          `Failed to initiate QR generation: ${initError instanceof Error ? initError.message : String(initError)}`
        );

        // Clean up correlation ID
        this.correlationIds.delete(session.sessionId);

        throw initError;
      }

      return session;
    } catch (error) {
      contextLogger.error('QR code generation failed', error as Error);
      throw error;
    }
    }, 'generateQRCode', { deviceId, userId });
    }, { deviceId, userId, operation: 'generateQRCode' });
  }

  /**
   * Get the current status of a QR code session with accurate reporting
   */
  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    const contextLogger = this.getSessionLogger(sessionId, 'getSessionStatus');
    contextLogger.info('Getting session status');

    try {
      if (!sessionId) {
        throw new ValidationError('Session ID is required');
      }

      const correlationId = this.correlationIds.get(sessionId);
      const session = this.sessionStore.getSession(sessionId);
      if (!session) {
        // If session is not found, it was likely expired and cleaned up
        this.logger.info('Session not found, likely expired', { sessionId, correlationId });
        
        // Clean up correlation ID if it exists
        this.correlationIds.delete(sessionId);
        
        return 'expired';
      }

      // Check if session is expired (double-check in case cleanup hasn't run yet)
      if (session.expiresAt.getTime() < Date.now()) {
        this.logger.info('Session expired', { sessionId, correlationId });
        
        // Clean up client resources for expired session
        await this.cleanupClientResources(session.deviceId);
        
        // Update session status to expired
        this.sessionStore.updateSession(sessionId, { 
          status: 'expired',
          error: 'Session expired'
        });
        
        // Clean up correlation ID
        this.correlationIds.delete(sessionId);
        
        return 'expired';
      }

      // For pending sessions, check if they've been stuck too long
      if (session.status === 'pending') {
        const timeSinceCreation = Date.now() - session.createdAt.getTime();
        const timeoutThreshold = this.config.qrGenerationTimeoutMs * 2; // Double the timeout for stuck detection
        
        if (timeSinceCreation > timeoutThreshold) {
          this.logger.info('Session appears stuck in pending state', { 
            sessionId, 
            timeSinceCreation,
            timeoutThreshold,
            correlationId 
          });
          
          // Try to recover by retrying QR generation
          this.handleQRGenerationTimeout(sessionId).catch(error => {
            this.logger.error('Error handling stuck session', error, { sessionId, correlationId });
          });
        }
      }

      this.logger.info('Session status retrieved', { 
        sessionId, 
        status: session.status,
        timeRemaining: Math.max(0, session.expiresAt.getTime() - Date.now()),
        correlationId 
      });

      return session.status;

    } catch (error) {
      this.logger.error('Failed to get session status', error, { sessionId, correlationId });
      
      if (error instanceof QRCodeError) {
        throw error;
      }
      
      throw new ValidationError(
        `Failed to get status for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get full session details
   */
  async getSession(sessionId: string): Promise<QRCodeSession | null> {
    const correlationId = this.correlationIds.get(sessionId) || uuidv4();
    this.logger.info('Getting session details', { sessionId, correlationId });

    try {
      if (!sessionId) {
        throw new ValidationError('Session ID is required');
      }

      const session = this.sessionStore.getSession(sessionId);
      if (!session) {
        this.logger.info('Session not found', { sessionId, correlationId });
        return null;
      }

      this.logger.info('Session details retrieved', { 
        sessionId, 
        status: session.status,
        correlationId 
      });

      return session;

    } catch (error) {
      this.logger.error('Failed to get session details', error, { sessionId, correlationId });
      
      if (error instanceof QRCodeError) {
        throw error;
      }
      
      throw new ValidationError(
        `Failed to get session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Cancel an active QR code session
   */
  async cancelSession(sessionId: string): Promise<void> {
    const correlationId = this.correlationIds.get(sessionId) || uuidv4();
    this.logger.info('Cancelling session', { sessionId, correlationId });

    try {
      if (!sessionId) {
        throw new ValidationError('Session ID is required');
      }

      const session = this.sessionStore.getSession(sessionId);
      if (!session) {
        throw new SessionNotFoundError(`Session ${sessionId} not found`);
      }

      // Clean up WhatsApp client resources first
      await this.cleanupClientResources(session.deviceId);

      // Update session status to failed
      const updated = this.sessionStore.updateSession(sessionId, {
        status: 'failed',
        error: 'Session cancelled by user'
      });

      if (!updated) {
        throw new SessionNotFoundError(`Session ${sessionId} could not be updated`);
      }

      this.logger.info('Session cancelled successfully', { sessionId, correlationId });

      // Clean up correlation ID
      this.correlationIds.delete(sessionId);

    } catch (error) {
      this.logger.error('Failed to cancel session', error, { sessionId, correlationId });
      
      if (error instanceof QRCodeError) {
        throw error;
      }
      
      throw new ValidationError(
        `Failed to cancel session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Comprehensive cleanup of all sessions and resources
   */
  async performComprehensiveCleanup(): Promise<{
    expiredSessionsCleanedUp: number;
    abandonedSessionsCleanedUp: number;
    orphanedTimeoutsCleared: number;
    correlationIdsRemoved: number;
  }> {
    const correlationId = uuidv4();
    this.logger.info('Starting comprehensive cleanup', { correlationId });

    try {
      // Track cleanup statistics
      let expiredSessionsCleanedUp = 0;
      let abandonedSessionsCleanedUp = 0;
      let orphanedTimeoutsCleared = 0;
      let correlationIdsRemoved = 0;

      // 1. Clean up expired sessions
      const expiredSessions = this.sessionStore.getExpiredSessions();
      if (expiredSessions.length > 0) {
        await this.cleanupExpiredSessions();
        expiredSessionsCleanedUp = expiredSessions.length;
      }

      // 2. Clean up abandoned sessions
      const pendingSessions = this.sessionStore.getSessionsByStatus('pending');
      const abandonedSessions = pendingSessions.filter(session => {
        const timeSinceCreation = Date.now() - session.createdAt.getTime();
        const abandonedThreshold = this.config.qrGenerationTimeoutMs * 3;
        return timeSinceCreation > abandonedThreshold;
      });

      if (abandonedSessions.length > 0) {
        await this.cleanupAbandonedSessions();
        abandonedSessionsCleanedUp = abandonedSessions.length;
      }

      // 3. Clean up orphaned correlation IDs
      const correlationIdsToRemove: string[] = [];
      for (const [sessionId] of this.correlationIds) {
        if (!this.sessionStore.getSession(sessionId)) {
          correlationIdsToRemove.push(sessionId);
        }
      }

      for (const sessionId of correlationIdsToRemove) {
        this.correlationIds.delete(sessionId);
      }
      correlationIdsRemoved = correlationIdsToRemove.length;

      // 4. Clean up orphaned QR generation timeouts
      const orphanedTimeouts: string[] = [];
      for (const [sessionId, timeout] of this.qrGenerationTimeouts) {
        if (!this.sessionStore.getSession(sessionId)) {
          clearTimeout(timeout);
          orphanedTimeouts.push(sessionId);
        }
      }

      for (const sessionId of orphanedTimeouts) {
        this.qrGenerationTimeouts.delete(sessionId);
      }
      orphanedTimeoutsCleared = orphanedTimeouts.length;

      const result = {
        expiredSessionsCleanedUp,
        abandonedSessionsCleanedUp,
        orphanedTimeoutsCleared,
        correlationIdsRemoved
      };

      this.logger.info('Comprehensive cleanup completed', { 
        ...result,
        correlationId 
      });

      return result;

    } catch (error) {
      this.logger.error('Failed to perform comprehensive cleanup', error, { correlationId });
      throw new ValidationError(
        `Failed to perform comprehensive cleanup: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Clean up abandoned sessions (sessions stuck in pending state for too long)
   */
  async cleanupAbandonedSessions(): Promise<void> {
    const correlationId = uuidv4();
    this.logger.info('Starting abandoned session cleanup', { correlationId });

    try {
      const pendingSessions = this.sessionStore.getSessionsByStatus('pending');
      const abandonedSessions = pendingSessions.filter(session => {
        const timeSinceCreation = Date.now() - session.createdAt.getTime();
        const abandonedThreshold = this.config.qrGenerationTimeoutMs * 3; // 3x the QR timeout
        return timeSinceCreation > abandonedThreshold;
      });

      if (abandonedSessions.length === 0) {
        this.logger.info('No abandoned sessions found during cleanup', { correlationId });
        return;
      }

      this.logger.info('Found abandoned sessions for cleanup', { 
        abandonedCount: abandonedSessions.length,
        correlationId 
      });

      // Clean up abandoned sessions
      const cleanupPromises = abandonedSessions.map(async (session) => {
        try {
          this.logger.info('Cleaning up abandoned session', {
            sessionId: session.sessionId,
            deviceId: session.deviceId,
            timeSinceCreation: Date.now() - session.createdAt.getTime(),
            correlationId
          });

          // Clean up client resources
          await this.cleanupClientResources(session.deviceId);

          // Update session status to failed
          this.sessionStore.updateSession(session.sessionId, {
            status: 'failed',
            error: 'Session abandoned - stuck in pending state too long'
          });

          // Remove correlation ID
          this.correlationIds.delete(session.sessionId);

          return { success: true, sessionId: session.sessionId };
        } catch (error) {
          this.logger.error('Error cleaning up abandoned session', error, {
            sessionId: session.sessionId,
            deviceId: session.deviceId,
            correlationId
          });
          return { success: false, sessionId: session.sessionId, error };
        }
      });

      const results = await Promise.allSettled(cleanupPromises);
      const successfulCleanups = results
        .filter(result => result.status === 'fulfilled' && result.value.success)
        .length;
      const failedCleanups = results.length - successfulCleanups;

      this.logger.info('Abandoned session cleanup completed', {
        abandonedSessionsFound: abandonedSessions.length,
        successfulCleanups,
        failedCleanups,
        correlationId
      });

    } catch (error) {
      this.logger.error('Failed to cleanup abandoned sessions', error, { correlationId });
      throw new ValidationError(
        `Failed to cleanup abandoned sessions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Clean up expired sessions and associated resources
   */
  async cleanupExpiredSessions(): Promise<void> {
    const correlationId = uuidv4();
    this.logger.info('Starting expired session cleanup', { correlationId });

    try {
      // Get expired sessions before cleanup to handle client resources
      const expiredSessions = this.sessionStore.getExpiredSessions();
      
      if (expiredSessions.length === 0) {
        this.logger.info('No expired sessions found during cleanup', { correlationId });
        return;
      }

      this.logger.info('Found expired sessions for cleanup', { 
        expiredCount: expiredSessions.length,
        correlationId 
      });

      // Clean up client resources for expired sessions with individual timeouts
      const clientCleanupPromises = expiredSessions.map(async (session) => {
        try {
          // Add timeout for individual client cleanup
          await Promise.race([
            this.cleanupClientResources(session.deviceId),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Client cleanup timeout')), 10000)
            )
          ]);
          
          this.logger.info('Client resources cleaned up for expired session', {
            sessionId: session.sessionId,
            deviceId: session.deviceId,
            correlationId
          });
          
          return { success: true, sessionId: session.sessionId, deviceId: session.deviceId };
        } catch (error) {
          this.logger.error('Error cleaning up client resources for expired session', error, {
            sessionId: session.sessionId,
            deviceId: session.deviceId,
            correlationId
          });
          
          return { success: false, sessionId: session.sessionId, deviceId: session.deviceId, error };
        }
      });

      // Wait for all client cleanups to complete with overall timeout
      const clientCleanupResults = await Promise.allSettled(clientCleanupPromises);
      const successfulCleanups = clientCleanupResults
        .filter(result => result.status === 'fulfilled' && result.value.success)
        .length;
      const failedCleanups = clientCleanupResults.length - successfulCleanups;
      
      // Now clean up the sessions from the store
      const cleanedCount = this.sessionStore.cleanup();

      // Remove correlation IDs for sessions that no longer exist
      const correlationIdsToRemove: string[] = [];
      for (const [sessionId] of this.correlationIds) {
        if (!this.sessionStore.getSession(sessionId)) {
          correlationIdsToRemove.push(sessionId);
        }
      }

      for (const sessionId of correlationIdsToRemove) {
        this.correlationIds.delete(sessionId);
      }

      // Clean up any orphaned QR generation timeouts
      const orphanedTimeouts: string[] = [];
      for (const [sessionId, timeout] of this.qrGenerationTimeouts) {
        if (!this.sessionStore.getSession(sessionId)) {
          clearTimeout(timeout);
          orphanedTimeouts.push(sessionId);
        }
      }

      for (const sessionId of orphanedTimeouts) {
        this.qrGenerationTimeouts.delete(sessionId);
      }

      this.logger.info('Expired session cleanup completed', { 
        expiredSessionsFound: expiredSessions.length,
        cleanedCount, 
        successfulClientCleanups: successfulCleanups,
        failedClientCleanups: failedCleanups,
        correlationIdsRemoved: correlationIdsToRemove.length,
        orphanedTimeoutsCleared: orphanedTimeouts.length,
        correlationId 
      });

      // Log warning if there were failures
      if (failedCleanups > 0) {
        this.logger.info('Some client cleanups failed during expired session cleanup', {
          failedCount: failedCleanups,
          totalCount: expiredSessions.length,
          correlationId
        });
      }

    } catch (error) {
      this.logger.error('Failed to cleanup expired sessions', error, { correlationId });
      
      throw new ValidationError(
        `Failed to cleanup expired sessions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<QRCodeSession[]> {
    const correlationId = uuidv4();
    this.logger.info('Getting user sessions', { userId, correlationId });

    try {
      if (!userId) {
        throw new ValidationError('User ID is required');
      }

      const sessions = this.sessionStore.getUserSessions(userId);
      
      this.logger.info('User sessions retrieved', { 
        userId, 
        sessionCount: sessions.length,
        correlationId 
      });

      return sessions;

    } catch (error) {
      this.logger.error('Failed to get user sessions', error, { userId, correlationId });
      
      if (error instanceof QRCodeError) {
        throw error;
      }
      
      throw new ValidationError(
        `Failed to get sessions for user ${userId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Update session with QR code data (called by WhatsApp client)
   */
  async updateSessionWithQRCode(sessionId: string, qrCode: string): Promise<void> {
    const correlationId = this.correlationIds.get(sessionId) || uuidv4();
    this.logger.info('Updating session with QR code', { sessionId, correlationId });

    try {
      const updated = this.sessionStore.updateSession(sessionId, {
        qrCode,
        status: 'generated'
      });

      if (!updated) {
        throw new SessionNotFoundError(`Session ${sessionId} not found or expired`);
      }

      this.logger.info('Session updated with QR code', { sessionId, correlationId });

    } catch (error) {
      this.logger.error('Failed to update session with QR code', error, { sessionId, correlationId });
      throw error;
    }
  }

  /**
   * Update session status (called by WhatsApp client events)
   */
  async updateSessionStatus(sessionId: string, status: SessionStatus, error?: string): Promise<void> {
    const correlationId = this.correlationIds.get(sessionId) || uuidv4();
    this.logger.info('Updating session status', { sessionId, status, error, correlationId });

    try {
      const updates: Partial<QRCodeSession> = { status };
      if (error) {
        updates.error = error;
      }

      const updated = this.sessionStore.updateSession(sessionId, updates);

      if (!updated) {
        throw new SessionNotFoundError(`Session ${sessionId} not found or expired`);
      }

      this.logger.info('Session status updated', { sessionId, status, correlationId });

      // Clean up correlation ID if session is complete
      if (status === 'connected' || status === 'failed' || status === 'expired') {
        this.correlationIds.delete(sessionId);
      }

    } catch (error) {
      this.logger.error('Failed to update session status', error, { sessionId, status, correlationId });
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): QRCodeManagerConfig {
    return { ...this.config };
  }

  /**
   * Get all sessions for a device
   */
  async getDeviceSessions(deviceId: string): Promise<QRCodeSession[]> {
    const correlationId = uuidv4();
    this.logger.info('Getting device sessions', { deviceId, correlationId });

    try {
      if (!deviceId) {
        throw new ValidationError('Device ID is required');
      }

      const sessions = this.sessionStore.getDeviceSessions(deviceId);
      
      this.logger.info('Device sessions retrieved', { 
        deviceId, 
        sessionCount: sessions.length,
        correlationId 
      });

      return sessions;

    } catch (error) {
      this.logger.error('Failed to get device sessions', error, { deviceId, correlationId });
      
      if (error instanceof QRCodeError) {
        throw error;
      }
      
      throw new ValidationError(
        `Failed to get sessions for device ${deviceId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get sessions by status for monitoring
   */
  async getSessionsByStatus(status: SessionStatus): Promise<QRCodeSession[]> {
    const correlationId = uuidv4();
    this.logger.info('Getting sessions by status', { status, correlationId });

    try {
      const sessions = this.sessionStore.getSessionsByStatus(status);
      
      this.logger.info('Sessions by status retrieved', { 
        status, 
        sessionCount: sessions.length,
        correlationId 
      });

      return sessions;

    } catch (error) {
      this.logger.error('Failed to get sessions by status', error, { status, correlationId });
      
      throw new ValidationError(
        `Failed to get sessions by status ${status}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get session store statistics
   */
  getStatistics(): {
    activeSessionCount: number;
    totalCorrelationIds: number;
    sessionsByStatus: Record<SessionStatus, number>;
    config: QRCodeManagerConfig;
  } {
    const sessionsByStatus: Record<SessionStatus, number> = {
      pending: 0,
      generated: 0,
      scanned: 0,
      connected: 0,
      expired: 0,
      failed: 0,
    };

    // Count sessions by status (this is a simplified approach)
    try {
      for (const status of Object.keys(sessionsByStatus) as SessionStatus[]) {
        sessionsByStatus[status] = this.sessionStore.getSessionsByStatus(status).length;
      }
    } catch (error) {
      this.logger.error('Error getting session statistics', error);
    }

    return {
      activeSessionCount: this.sessionStore.getActiveSessionCount(),
      totalCorrelationIds: this.correlationIds.size,
      sessionsByStatus,
      config: this.config,
    };
  }

  /**
   * Clean up WhatsApp client resources for a device
   */
  private async cleanupClientResources(deviceId: string): Promise<void> {
    const correlationId = uuidv4();
    this.logger.info('Cleaning up client resources', { deviceId, correlationId });

    try {
      // Import WhatsApp Client Factory directly to avoid circular dependencies
      const { default: whatsAppClientFactory } = await import('./whatsapp-client-factory.service');
      
      // Check if client exists before attempting cleanup
      if (whatsAppClientFactory.hasClient(deviceId)) {
        this.logger.info('Client found for cleanup', { deviceId, correlationId });
        
        // Add timeout for client destruction
        await Promise.race([
          whatsAppClientFactory.destroyClient(deviceId),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Client destruction timeout')), 8000)
          )
        ]);
        
        this.logger.info('Client destroyed successfully', { deviceId, correlationId });
      } else {
        this.logger.info('No client found for cleanup', { deviceId, correlationId });
      }
      
      // Additional cleanup: clear any remaining timeouts for this device
      const timeoutsToRemove: string[] = [];
      for (const [sessionId, timeout] of this.qrGenerationTimeouts) {
        const session = this.sessionStore.getSession(sessionId);
        if (session && session.deviceId === deviceId) {
          clearTimeout(timeout);
          timeoutsToRemove.push(sessionId);
        }
      }
      
      for (const sessionId of timeoutsToRemove) {
        this.qrGenerationTimeouts.delete(sessionId);
      }
      
      if (timeoutsToRemove.length > 0) {
        this.logger.info('Cleared QR generation timeouts for device', { 
          deviceId, 
          timeoutsCleared: timeoutsToRemove.length,
          correlationId 
        });
      }
      
      this.logger.info('Client resources cleaned up successfully', { deviceId, correlationId });
      
    } catch (error) {
      this.logger.error('Error cleaning up client resources', error, { deviceId, correlationId });
      // Don't throw error here as cleanup should be best-effort
      // But we can still attempt to clear timeouts even if client cleanup fails
      try {
        const timeoutsToRemove: string[] = [];
        for (const [sessionId, timeout] of this.qrGenerationTimeouts) {
          const session = this.sessionStore.getSession(sessionId);
          if (session && session.deviceId === deviceId) {
            clearTimeout(timeout);
            timeoutsToRemove.push(sessionId);
          }
        }
        
        for (const sessionId of timeoutsToRemove) {
          this.qrGenerationTimeouts.delete(sessionId);
        }
        
        if (timeoutsToRemove.length > 0) {
          this.logger.info('Cleared QR generation timeouts despite client cleanup failure', { 
            deviceId, 
            timeoutsCleared: timeoutsToRemove.length,
            correlationId 
          });
        }
      } catch (timeoutError) {
        this.logger.error('Error clearing timeouts during failed client cleanup', timeoutError, { 
          deviceId, 
          correlationId 
        });
      }
    }
  }

  /**
   * Retry QR code generation with exponential backoff
   */
  private async retryQRCodeGeneration(
    session: QRCodeSession, 
    attempt: number = 1, 
    maxRetries: number = 3
  ): Promise<void> {
    const correlationId = this.correlationIds.get(session.sessionId);
    this.logger.info('Retrying QR code generation', { 
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      attempt,
      maxRetries,
      correlationId 
    });

    if (attempt > maxRetries) {
      this.logger.error('Max retries exceeded for QR code generation', new Error('Max retries exceeded'), {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        attempt,
        maxRetries,
        correlationId
      });
      
      await this.updateSessionStatus(
        session.sessionId,
        'failed',
        `QR code generation failed after ${maxRetries} attempts`
      );
      return;
    }

    try {
      // Clean up any existing client resources before retry
      await this.cleanupClientResources(session.deviceId);
      
      // Wait with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
      if (delay > 0) {
        this.logger.info('Waiting before retry', { delay, attempt, correlationId });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      // Check if session is still valid before retrying
      const currentSession = this.sessionStore.getSession(session.sessionId);
      if (!currentSession || currentSession.status === 'failed' || currentSession.status === 'expired') {
        this.logger.info('Session no longer valid, aborting retry', { 
          sessionId: session.sessionId,
          currentStatus: currentSession?.status,
          correlationId 
        });
        return;
      }
      
      // Retry QR code generation
      await this.initiateQRCodeGeneration(session);
      
    } catch (error) {
      this.logger.error('Retry attempt failed', error, {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        attempt,
        correlationId
      });
      
      // Schedule next retry
      setTimeout(() => {
        this.retryQRCodeGeneration(session, attempt + 1, maxRetries);
      }, 1000); // Short delay before next retry
    }
  }

  /**
   * Handle QR code generation timeout with retry logic
   */
  async handleQRGenerationTimeout(sessionId: string): Promise<void> {
    const correlationId = this.correlationIds.get(sessionId) || uuidv4();
    this.logger.info('Handling QR generation timeout', { sessionId, correlationId });

    try {
      const session = this.sessionStore.getSession(sessionId);
      if (!session) {
        this.logger.info('Session not found during timeout handling', { sessionId, correlationId });
        return;
      }

      // Check if we should retry
      if (session.status === 'pending') {
        this.logger.info('Attempting retry after timeout', { sessionId, correlationId });
        await this.retryQRCodeGeneration(session);
      } else {
        this.logger.info('Session status changed, not retrying', { 
          sessionId, 
          status: session.status, 
          correlationId 
        });
      }

    } catch (error) {
      this.logger.error('Error handling QR generation timeout', error, { sessionId, correlationId });
      
      // Update session to failed as fallback
      try {
        await this.updateSessionStatus(sessionId, 'failed', 'Timeout handling failed');
      } catch (updateError) {
        this.logger.error('Failed to update session status during timeout handling', updateError, { 
          sessionId, 
          correlationId 
        });
      }
    }
  }

  /**
   * Gracefully shutdown the manager and clean up all resources
   */
  async gracefulShutdown(): Promise<void> {
    const correlationId = uuidv4();
    this.logger.info('Starting graceful shutdown', { correlationId });

    try {
      // Stop the cleanup timer first
      this.stopCleanupTimer();

      // Get all active sessions by iterating through correlation IDs
      const activeSessionIds = Array.from(this.correlationIds.keys());
      this.logger.info('Found active sessions for shutdown cleanup', { 
        sessionCount: activeSessionIds.length,
        correlationId 
      });
      
      // Cancel all active sessions and clean up their resources with timeout
      const cancelPromises = activeSessionIds.map(sessionId => 
        Promise.race([
          this.cancelSession(sessionId),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Session cancellation timeout')), 10000)
          )
        ]).catch(error => {
          this.logger.error('Error cancelling session during shutdown', error, { 
            sessionId, 
            correlationId 
          });
          return error; // Return error instead of throwing to continue with other sessions
        })
      );

      // Wait for all cancellations to complete with overall timeout
      const cancellationResults = await Promise.allSettled(cancelPromises);
      const failedCancellations = cancellationResults.filter(result => result.status === 'rejected').length;
      
      if (failedCancellations > 0) {
        this.logger.info('Some session cancellations failed during shutdown', { 
          failedCount: failedCancellations,
          totalCount: activeSessionIds.length,
          correlationId 
        });
      }

      // Clean up all client resources with timeout
      try {
        const { default: whatsAppClientFactory } = await import('./whatsapp-client-factory.service');
        
        await Promise.race([
          whatsAppClientFactory.destroyAllClients(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Client cleanup timeout')), 15000)
          )
        ]);
        
        this.logger.info('All WhatsApp clients destroyed during shutdown', { correlationId });
      } catch (error) {
        this.logger.error('Error cleaning up all clients during shutdown', error, { correlationId });
        // Continue with shutdown even if client cleanup fails
      }

      // Clear all QR generation timeouts
      let timeoutsClearedCount = 0;
      for (const timeout of this.qrGenerationTimeouts.values()) {
        clearTimeout(timeout);
        timeoutsClearedCount++;
      }
      this.qrGenerationTimeouts.clear();

      // Clear correlation IDs
      const correlationIdsCount = this.correlationIds.size;
      this.correlationIds.clear();

      // Final cleanup of session store
      try {
        this.sessionStore.clear();
        this.logger.info('Session store cleared during shutdown', { correlationId });
      } catch (error) {
        this.logger.error('Error clearing session store during shutdown', error, { correlationId });
      }

      this.logger.info('Graceful shutdown completed', { 
        sessionsCancelled: activeSessionIds.length - failedCancellations,
        timeoutsCleared: timeoutsClearedCount,
        correlationIdsCleared: correlationIdsCount,
        correlationId 
      });

    } catch (error) {
      this.logger.error('Error during graceful shutdown', error, { correlationId });
      throw error;
    }
  }

  /**
   * Destroy the manager and clean up resources (synchronous)
   */
  destroy(): void {
    this.logger.info('Destroying QR Code Manager');
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // Clear all QR generation timeouts
    for (const timeout of this.qrGenerationTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.qrGenerationTimeouts.clear();
    
    this.correlationIds.clear();
    
    this.logger.info('QR Code Manager destroyed');
  }

  /**
   * Validate parameters for generateQRCode method
   */
  private validateGenerateQRCodeParams(deviceId: string, userId: string): void {
    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0) {
      throw new ValidationError('Device ID is required and must be a non-empty string');
    }

    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      throw new ValidationError('User ID is required and must be a non-empty string');
    }
  }

  /**
   * Create a context logger for a specific operation
   */
  private createContextLogger(operation: string, context: Record<string, any> = {}): Logger {
    const correlationId = context.correlationId || generateCorrelationId();
    return this.logger.child(correlationId, { operation, ...context });
  }

  /**
   * Get context logger for existing session
   */
  private getSessionLogger(sessionId: string, operation: string, additionalContext: Record<string, any> = {}): Logger {
    const correlationId = this.correlationIds.get(sessionId) || generateCorrelationId();
    const session = this.sessionStore.getSession(sessionId);
    const context: Record<string, any> = {
      sessionId,
      operation,
      ...additionalContext,
    };

    if (session) {
      context.deviceId = session.deviceId;
      context.userId = session.userId;
    }

    return this.logger.child(correlationId, context);
  }

  /**
   * Initiate QR code generation process using the WhatsApp Client Factory directly
   */
  private async initiateQRCodeGeneration(session: QRCodeSession): Promise<void> {
    const contextLogger = this.getSessionLogger(session.sessionId, 'initiateQRCodeGeneration');

    return await retryStrategy.executeWithRetry(async () => {
      contextLogger.info('Initiating QR code generation');

      // Import WhatsApp Client Factory directly to avoid circular dependencies
      let whatsAppClientFactory;
      try {
        const factoryModule = await import('./whatsapp-client-factory.service');
        whatsAppClientFactory = factoryModule.default;

        if (!whatsAppClientFactory) {
          throw new ClientInitializationError(session.deviceId, 'WhatsApp Client Factory not available');
        }
      } catch (importError) {
        contextLogger.error('Failed to import WhatsApp Client Factory', importError as Error);
        throw new ClientInitializationError(session.deviceId,
          `Failed to load WhatsApp Client Factory: ${importError instanceof Error ? importError.message : String(importError)}`);
      }

      // Create client configuration with enhanced timeouts
      const clientConfig = {
        deviceId: session.deviceId,
        clientType: session.clientType,
        timeouts: {
          qrGeneration: this.config.qrGenerationTimeoutMs,
          connection: this.config.sessionExpirationMs,
          initialization: this.config.qrGenerationTimeoutMs * 2,
        }
      };

      // Clean up any existing client for this device with timeout
      if (whatsAppClientFactory.hasClient(session.deviceId)) {
        try {
          await timeoutManager.executeWithTimeout(
            () => whatsAppClientFactory.destroyClient(session.deviceId),
            'clientDestruction',
            { deviceId: session.deviceId, sessionId: session.sessionId }
          );
          contextLogger.info('Existing client destroyed successfully');
        } catch (destroyError) {
          contextLogger.warn('Failed to destroy existing client, continuing with new client creation', {
            error: destroyError instanceof Error ? destroyError.message : String(destroyError)
          });
          // Continue with client creation even if destroy fails
        }
      }

      // Create WhatsApp client with timeout protection
      let clientWrapper;
      try {
        clientWrapper = await timeoutManager.executeWithTimeout(
          () => whatsAppClientFactory.createClient(session.deviceId, clientConfig),
          'initialization',
          { deviceId: session.deviceId, sessionId: session.sessionId }
        );

        if (!clientWrapper) {
          throw new ClientInitializationError(session.deviceId, 'Client factory returned null/undefined client wrapper');
        }

        contextLogger.info('WhatsApp client created successfully', {
          clientType: clientWrapper.clientType || 'unknown'
        });
      } catch (createError) {
        contextLogger.error('Failed to create WhatsApp client', createError as Error);

        // Update session status to failed
        await this.updateSessionStatus(session.sessionId, 'failed',
          `Client creation failed: ${createError instanceof Error ? createError.message : String(createError)}`);

        throw createError;
      }

      // Set up event handlers for QR code generation
      this.setupClientEventHandlers(clientWrapper, session.sessionId);

      // Set up QR generation timeout using the new timeout manager
      const timeoutId = timeoutManager.setTimeout(
        'qrGeneration',
        async (operation, context) => {
          contextLogger.warn('QR generation timeout reached', { operation, timeoutMs: clientConfig.timeouts.qrGeneration });

          try {
            await this.updateSessionStatus(session.sessionId, 'expired', `QR generation timeout after ${clientConfig.timeouts.qrGeneration}ms`);
            await this.cleanupClientResources(session.deviceId);
          } catch (error) {
            contextLogger.error('Error handling QR generation timeout', error as Error);
          }
        },
        { sessionId: session.sessionId, deviceId: session.deviceId },
        clientConfig.timeouts.qrGeneration
      );

      // Store timeout ID for cleanup
      this.qrGenerationTimeouts.set(session.sessionId, timeoutId as any);

      // Initialize the client to start QR generation with timeout protection
      contextLogger.info('Initializing WhatsApp client');

      await timeoutManager.executeWithTimeout(
        () => clientWrapper.initialize(),
        'initialization',
        { deviceId: session.deviceId, sessionId: session.sessionId }
      );
    }, 'qrGeneration', {
      sessionId: session.sessionId,
      deviceId: session.deviceId
    });
  }

  /**
   * Set up event handlers for the WhatsApp client
   */
  private setupClientEventHandlers(clientWrapper: any, sessionId: string): void {
    const correlationId = this.correlationIds.get(sessionId);
    const deviceId = clientWrapper.deviceId;
    
    this.logger.info('Setting up client event handlers', { 
      sessionId,
      deviceId,
      correlationId 
    });

    // QR code event - update session with QR code
    clientWrapper.onQR(async (qr: string) => {
      this.logger.info('QR code received from client', { sessionId, deviceId, correlationId });
      
      // Clear QR generation timeout since we got a QR code
      this.clearQRGenerationTimeout(sessionId);
      
      try {
        await this.updateSessionWithQRCode(sessionId, qr);
        this.logger.info('QR code updated in session', { sessionId, correlationId });
      } catch (error) {
        this.logger.error('Error updating QR code in session', error, { sessionId, correlationId });
        await this.updateSessionStatus(sessionId, 'failed', `Failed to update QR code: ${error.message}`);
      }
    });

    // Ready event - client is connected
    clientWrapper.onReady(async (info: any) => {
      this.logger.info('WhatsApp client ready', { sessionId, deviceId, correlationId });
      
      // Clear QR generation timeout since we're connected
      this.clearQRGenerationTimeout(sessionId);
      
      try {
        await this.updateSessionStatus(sessionId, 'connected');
        this.logger.info('Session marked as connected', { sessionId, correlationId });
        
        // Clean up the client after successful connection
        setTimeout(async () => {
          await this.cleanupClientResources(deviceId);
        }, 5000); // Give some time for any final operations
        
      } catch (error) {
        this.logger.error('Error updating session status to connected', error, { sessionId, correlationId });
      }
    });

    // Disconnected event
    clientWrapper.onDisconnected(async (reason: string) => {
      this.logger.info('WhatsApp client disconnected', { sessionId, deviceId, reason, correlationId });
      
      // Clear QR generation timeout
      this.clearQRGenerationTimeout(sessionId);
      
      try {
        // Only update to failed if the session is not already connected
        const currentSession = this.sessionStore.getSession(sessionId);
        if (currentSession && currentSession.status !== 'connected') {
          await this.updateSessionStatus(sessionId, 'failed', `Client disconnected: ${reason}`);
        }
      } catch (error) {
        this.logger.error('Error handling client disconnection', error, { sessionId, correlationId });
      }
      
      // Clean up the client
      await this.cleanupClientResources(deviceId);
    });

    // Error event
    clientWrapper.onError(async (error: Error) => {
      this.logger.error('WhatsApp client error', error, { sessionId, deviceId, correlationId });
      
      // Clear QR generation timeout
      this.clearQRGenerationTimeout(sessionId);
      
      try {
        let errorMessage = error.message;
        let sessionStatus: 'failed' | 'expired' = 'failed';
        
        // Handle specific error types
        if (error instanceof QRGenerationTimeoutError) {
          errorMessage = `QR generation timeout after ${(error as any).details?.timeout || 'unknown'}ms`;
          sessionStatus = 'expired';
        } else if (error instanceof ClientInitializationError) {
          errorMessage = `Client initialization failed: ${error.message}`;
        } else if (error.name === 'BrowserLaunchError') {
          errorMessage = `Browser launch failed: ${error.message}`;
        }
        
        await this.updateSessionStatus(sessionId, sessionStatus, errorMessage);
        this.logger.info('Session marked as failed due to client error', { sessionId, sessionStatus, correlationId });
        
      } catch (updateError) {
        this.logger.error('Error updating session status for client error', updateError, { sessionId, correlationId });
      }
      
      // Clean up the client
      await this.cleanupClientResources(deviceId);
    });
  }

  /**
   * Set up QR generation timeout for a session
   */
  private setupQRGenerationTimeout(sessionId: string, timeoutMs: number): void {
    const correlationId = this.correlationIds.get(sessionId);
    
    // Clear any existing timeout
    this.clearQRGenerationTimeout(sessionId);
    
    const timeout = setTimeout(async () => {
      this.logger.info('QR generation timeout reached', { sessionId, timeoutMs, correlationId });
      
      try {
        // Update session status to expired
        await this.updateSessionStatus(sessionId, 'expired', `QR generation timeout after ${timeoutMs}ms`);
        
        // Get session to find device ID for cleanup
        const session = this.sessionStore.getSession(sessionId);
        if (session) {
          await this.cleanupClientResources(session.deviceId);
        }
        
      } catch (error) {
        this.logger.error('Error handling QR generation timeout', error, { sessionId, correlationId });
      }
    }, timeoutMs);
    
    // Store timeout reference (we'll use a Map for this)
    if (!this.qrGenerationTimeouts) {
      this.qrGenerationTimeouts = new Map();
    }
    this.qrGenerationTimeouts.set(sessionId, timeout);
  }

  /**
   * Clear QR generation timeout for a session
   */
  private clearQRGenerationTimeout(sessionId: string): void {
    if (!this.qrGenerationTimeouts) {
      return;
    }

    const timeoutId = this.qrGenerationTimeouts.get(sessionId);
    if (timeoutId) {
      // Clear timeout using timeout manager if it's a string ID, otherwise use legacy clearTimeout
      if (typeof timeoutId === 'string') {
        timeoutManager.clearTimeout(timeoutId);
      } else {
        clearTimeout(timeoutId);
      }
      this.qrGenerationTimeouts.delete(sessionId);
    }
  }

  /**
   * Start the automatic cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.config.cleanupIntervalMs <= 0) {
      this.logger.info('Automatic cleanup disabled (cleanupIntervalMs <= 0)');
      return; // Cleanup disabled
    }

    this.logger.info('Starting automatic cleanup timer', {
      intervalMs: this.config.cleanupIntervalMs
    });

    this.cleanupTimer = setInterval(async () => {
      try {
        // Clean up expired sessions first
        await this.cleanupExpiredSessions();
        
        // Then clean up abandoned sessions
        await this.cleanupAbandonedSessions();
      } catch (error) {
        this.logger.error('Error during automatic cleanup', error as Error);
      }
    }, this.config.cleanupIntervalMs);

    // Ensure the timer doesn't keep the process alive
    this.cleanupTimer.unref();
  }

  /**
   * Stop the automatic cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      this.logger.info('Automatic cleanup timer stopped');
    }
  }


}

/**
 * Singleton instance of the QR Code Manager
 */
let qrCodeManagerInstance: QRCodeManager | null = null;

/**
 * Get the singleton QR Code Manager instance
 */
export function getQRCodeManager(config?: Partial<QRCodeManagerConfig>): QRCodeManager {
  if (!qrCodeManagerInstance) {
    qrCodeManagerInstance = new QRCodeManager(config);
  }
  return qrCodeManagerInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetQRCodeManager(): void {
  if (qrCodeManagerInstance) {
    qrCodeManagerInstance.destroy();
    qrCodeManagerInstance = null;
  }
}