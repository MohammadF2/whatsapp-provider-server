/**
 * Timeout Manager Service
 * 
 * Provides centralized timeout management with configurable timeouts,
 * automatic cleanup, and comprehensive timeout handling for the QR code system.
 */

import { createLogger, Logger, generateCorrelationId } from './logger.service';
import { QRGenerationTimeoutError } from '../models/qrcode.errors';

/**
 * Timeout configuration interface
 */
export interface TimeoutConfig {
  /** QR code generation timeout in milliseconds */
  qrGeneration: number;
  
  /** Connection establishment timeout in milliseconds */
  connection: number;
  
  /** Client initialization timeout in milliseconds */
  initialization: number;
  
  /** Browser launch timeout in milliseconds */
  browserLaunch: number;
  
  /** Session cleanup timeout in milliseconds */
  sessionCleanup: number;
  
  /** Client destruction timeout in milliseconds */
  clientDestruction: number;
  
  /** Network operation timeout in milliseconds */
  networkOperation: number;
  
  /** File operation timeout in milliseconds */
  fileOperation: number;
}

/**
 * Default timeout configuration
 */
export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  qrGeneration: 30000,      // 30 seconds
  connection: 60000,        // 60 seconds
  initialization: 120000,   // 2 minutes
  browserLaunch: 45000,     // 45 seconds
  sessionCleanup: 10000,    // 10 seconds
  clientDestruction: 8000,  // 8 seconds
  networkOperation: 15000,  // 15 seconds
  fileOperation: 5000,      // 5 seconds
};

/**
 * Timeout operation types
 */
export type TimeoutOperation = keyof TimeoutConfig;

/**
 * Timeout callback function
 */
export type TimeoutCallback = (operation: string, context?: Record<string, any>) => void | Promise<void>;

/**
 * Active timeout tracking
 */
interface ActiveTimeout {
  id: string;
  operation: TimeoutOperation;
  startTime: Date;
  timeoutMs: number;
  callback: TimeoutCallback;
  context?: Record<string, any>;
  timer: NodeJS.Timeout;
}

/**
 * Timeout Manager Service
 */
export class TimeoutManagerService {
  private readonly config: TimeoutConfig;
  private readonly logger: Logger;
  private readonly activeTimeouts: Map<string, ActiveTimeout> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<TimeoutConfig> = {}) {
    this.config = { ...DEFAULT_TIMEOUT_CONFIG, ...config };
    this.logger = createLogger('TimeoutManager', {
      enablePerformanceLogs: true,
    });
    
    this.startCleanupMonitoring();
    this.logger.info('Timeout manager initialized', { config: this.config });
  }

  /**
   * Set a timeout for an operation
   */
  setTimeout(
    operation: TimeoutOperation,
    callback: TimeoutCallback,
    context?: Record<string, any>,
    customTimeoutMs?: number
  ): string {
    const timeoutId = generateCorrelationId();
    const timeoutMs = customTimeoutMs || this.config[operation];
    
    const contextLogger = this.logger.child(timeoutId, { 
      operation, 
      timeoutMs,
      ...context 
    });
    
    contextLogger.debug('Setting timeout', { timeoutMs });

    const timer = setTimeout(async () => {
      contextLogger.warn('Timeout reached', { 
        operation,
        timeoutMs,
        elapsedTime: Date.now() - activeTimeout.startTime.getTime(),
      });

      try {
        await callback(operation, context);
      } catch (error) {
        contextLogger.error('Error in timeout callback', error as Error, { operation });
      } finally {
        this.clearTimeout(timeoutId);
      }
    }, timeoutMs);

    const activeTimeout: ActiveTimeout = {
      id: timeoutId,
      operation,
      startTime: new Date(),
      timeoutMs,
      callback,
      context,
      timer,
    };

    this.activeTimeouts.set(timeoutId, activeTimeout);
    
    contextLogger.debug('Timeout set successfully', { 
      timeoutId,
      activeTimeouts: this.activeTimeouts.size,
    });

    return timeoutId;
  }

  /**
   * Clear a specific timeout
   */
  clearTimeout(timeoutId: string): boolean {
    const timeout = this.activeTimeouts.get(timeoutId);
    if (!timeout) {
      this.logger.debug('Timeout not found for clearing', { timeoutId });
      return false;
    }

    clearTimeout(timeout.timer);
    this.activeTimeouts.delete(timeoutId);
    
    const elapsedTime = Date.now() - timeout.startTime.getTime();
    this.logger.debug('Timeout cleared', { 
      timeoutId,
      operation: timeout.operation,
      elapsedTime,
      wasActive: elapsedTime < timeout.timeoutMs,
    });

    return true;
  }

  /**
   * Clear all timeouts for a specific operation type
   */
  clearTimeoutsForOperation(operation: TimeoutOperation): number {
    let clearedCount = 0;
    
    for (const [timeoutId, timeout] of this.activeTimeouts) {
      if (timeout.operation === operation) {
        this.clearTimeout(timeoutId);
        clearedCount++;
      }
    }
    
    this.logger.debug('Cleared timeouts for operation', { 
      operation, 
      clearedCount,
    });

    return clearedCount;
  }

  /**
   * Execute operation with timeout protection
   */
  async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutOperation: TimeoutOperation,
    context?: Record<string, any>,
    customTimeoutMs?: number
  ): Promise<T> {
    const timeoutMs = customTimeoutMs || this.config[timeoutOperation];
    const correlationId = generateCorrelationId();
    const contextLogger = this.logger.child(correlationId, { 
      operation: timeoutOperation,
      timeoutMs,
      ...context 
    });

    return new Promise<T>(async (resolve, reject) => {
      let completed = false;
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          const error = new QRGenerationTimeoutError(
            context?.deviceId || 'unknown',
            timeoutMs
          );
          contextLogger.error('Operation timed out', error, { timeoutMs });
          reject(error);
        }
      }, timeoutMs);

      try {
        contextLogger.debug('Starting operation with timeout protection');
        const result = await operation();
        
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          contextLogger.debug('Operation completed successfully');
          resolve(result);
        }
      } catch (error) {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          contextLogger.error('Operation failed', error as Error);
          reject(error);
        }
      }
    });
  }

  /**
   * Execute operation with timeout and retry
   */
  async executeWithTimeoutAndRetry<T>(
    operation: () => Promise<T>,
    timeoutOperation: TimeoutOperation,
    maxRetries: number = 3,
    context?: Record<string, any>,
    customTimeoutMs?: number
  ): Promise<T> {
    const correlationId = generateCorrelationId();
    const contextLogger = this.logger.child(correlationId, { 
      operation: timeoutOperation,
      maxRetries,
      ...context 
    });

    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        contextLogger.debug('Attempting operation with timeout', { 
          attempt, 
          maxRetries: maxRetries + 1,
        });

        const result = await this.executeWithTimeout(
          operation,
          timeoutOperation,
          { ...context, attempt },
          customTimeoutMs
        );

        if (attempt > 1) {
          contextLogger.info('Operation succeeded after retry', { attempt });
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        
        contextLogger.warn('Operation attempt failed', { 
          attempt,
          error: lastError.message,
          errorType: lastError.constructor.name,
        });

        // Don't retry if we've reached max attempts
        if (attempt > maxRetries) {
          contextLogger.error('Max retry attempts exceeded', lastError, { 
            totalAttempts: attempt,
            maxRetries,
          });
          break;
        }

        // Wait before retrying with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        contextLogger.debug('Waiting before retry', { delay, nextAttempt: attempt + 1 });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Operation failed after all retry attempts');
  }

  /**
   * Get timeout configuration
   */
  getConfig(): TimeoutConfig {
    return { ...this.config };
  }

  /**
   * Update timeout configuration
   */
  updateConfig(updates: Partial<TimeoutConfig>): void {
    Object.assign(this.config, updates);
    this.logger.info('Timeout configuration updated', { updates });
  }

  /**
   * Get active timeout statistics
   */
  getActiveTimeoutStats(): {
    totalActive: number;
    byOperation: Record<TimeoutOperation, number>;
    oldestTimeout: Date | null;
    averageAge: number;
  } {
    const stats = {
      totalActive: this.activeTimeouts.size,
      byOperation: {} as Record<TimeoutOperation, number>,
      oldestTimeout: null as Date | null,
      averageAge: 0,
    };

    // Initialize operation counts
    for (const operation of Object.keys(this.config) as TimeoutOperation[]) {
      stats.byOperation[operation] = 0;
    }

    let totalAge = 0;
    const now = Date.now();

    for (const timeout of this.activeTimeouts.values()) {
      stats.byOperation[timeout.operation]++;
      
      const age = now - timeout.startTime.getTime();
      totalAge += age;
      
      if (!stats.oldestTimeout || timeout.startTime < stats.oldestTimeout) {
        stats.oldestTimeout = timeout.startTime;
      }
    }

    if (this.activeTimeouts.size > 0) {
      stats.averageAge = totalAge / this.activeTimeouts.size;
    }

    return stats;
  }

  /**
   * Clear all active timeouts
   */
  clearAllTimeouts(): number {
    const count = this.activeTimeouts.size;
    
    for (const timeout of this.activeTimeouts.values()) {
      clearTimeout(timeout.timer);
    }
    
    this.activeTimeouts.clear();
    
    this.logger.info('Cleared all active timeouts', { clearedCount: count });
    return count;
  }

  /**
   * Destroy the timeout manager and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.clearAllTimeouts();
    this.logger.info('Timeout manager destroyed');
  }

  /**
   * Start cleanup monitoring for stuck timeouts
   */
  private startCleanupMonitoring(): void {
    // Check for stuck timeouts every 30 seconds
    this.cleanupInterval = setInterval(() => {
      try {
        this.cleanupStuckTimeouts();
      } catch (error) {
        this.logger.error('Error during timeout cleanup monitoring', error as Error);
      }
    }, 30000);

    // Ensure the timer doesn't keep the process alive
    this.cleanupInterval.unref();
  }

  /**
   * Clean up timeouts that have been active for too long
   */
  private cleanupStuckTimeouts(): void {
    const now = Date.now();
    const maxAge = 300000; // 5 minutes
    const stuckTimeouts: string[] = [];

    for (const [timeoutId, timeout] of this.activeTimeouts) {
      const age = now - timeout.startTime.getTime();
      
      // If timeout has been active longer than its configured timeout + max age
      if (age > timeout.timeoutMs + maxAge) {
        stuckTimeouts.push(timeoutId);
      }
    }

    if (stuckTimeouts.length > 0) {
      this.logger.warn('Found stuck timeouts, cleaning up', { 
        stuckCount: stuckTimeouts.length,
        stuckTimeouts,
      });

      for (const timeoutId of stuckTimeouts) {
        this.clearTimeout(timeoutId);
      }
    }
  }
}

/**
 * Default timeout manager instance
 */
export const timeoutManager = new TimeoutManagerService();

/**
 * Create timeout manager with custom configuration
 */
export function createTimeoutManager(config: Partial<TimeoutConfig> = {}): TimeoutManagerService {
  return new TimeoutManagerService(config);
}
