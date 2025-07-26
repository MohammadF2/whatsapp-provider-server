/**
 * Error Recovery Service
 * 
 * Provides comprehensive error recovery mechanisms for the QR code system,
 * including retry logic, circuit breaker patterns, and graceful degradation.
 */

import { createLogger, Logger, generateCorrelationId } from './logger.service';
import { QRCodeError, ErrorCategory, isQRCodeError } from '../models/qrcode.errors';

/**
 * Recovery strategy configuration
 */
export interface RecoveryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  
  /** Base delay between retries in milliseconds */
  baseDelayMs: number;
  
  /** Maximum delay between retries in milliseconds */
  maxDelayMs: number;
  
  /** Exponential backoff multiplier */
  backoffMultiplier: number;
  
  /** Whether to use jitter in retry delays */
  useJitter: boolean;
  
  /** Circuit breaker failure threshold */
  circuitBreakerThreshold: number;
  
  /** Circuit breaker reset timeout in milliseconds */
  circuitBreakerResetTimeoutMs: number;
}

/**
 * Default recovery configuration
 */
const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  useJitter: true,
  circuitBreakerThreshold: 5,
  circuitBreakerResetTimeoutMs: 60000,
};

/**
 * Circuit breaker states
 */
enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

/**
 * Circuit breaker for error recovery
 */
class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly logger: Logger;

  constructor(
    private readonly name: string,
    private readonly config: RecoveryConfig,
    logger: Logger
  ) {
    this.logger = logger.child(generateCorrelationId(), { circuitBreaker: name });
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.logger.info('Circuit breaker transitioning to half-open state');
      } else {
        throw new Error(`Circuit breaker is open for ${this.name}`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.CLOSED;
      this.logger.info('Circuit breaker reset to closed state');
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.circuitBreakerThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.logger.warn('Circuit breaker opened due to failure threshold', {
        failureCount: this.failureCount,
        threshold: this.config.circuitBreakerThreshold,
      });
    }
  }

  /**
   * Check if circuit breaker should attempt reset
   */
  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.config.circuitBreakerResetTimeoutMs;
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): { state: CircuitBreakerState; failureCount: number; lastFailureTime: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

/**
 * Error Recovery Service
 */
export class ErrorRecoveryService {
  private readonly config: RecoveryConfig;
  private readonly logger: Logger;
  private readonly circuitBreakers: Map<string, CircuitBreaker> = new Map();

  constructor(config: Partial<RecoveryConfig> = {}) {
    this.config = { ...DEFAULT_RECOVERY_CONFIG, ...config };
    this.logger = createLogger('ErrorRecoveryService', {
      enablePerformanceLogs: true,
    });
  }

  /**
   * Execute operation with retry logic and error recovery
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    context: Record<string, any> = {}
  ): Promise<T> {
    const correlationId = generateCorrelationId();
    const contextLogger = this.logger.child(correlationId, { operation: operationName, ...context });
    
    return await contextLogger.withTiming(`retry-${operationName}`, async () => {
      let lastError: Error | undefined;
      
      for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt++) {
        try {
          contextLogger.debug('Attempting operation', { attempt, maxRetries: this.config.maxRetries });
          
          const result = await operation();
          
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

          // Don't retry on certain types of errors
          if (this.shouldNotRetry(lastError)) {
            contextLogger.info('Error type should not be retried', { 
              errorType: lastError.constructor.name,
            });
            throw lastError;
          }

          // Don't retry if we've reached max attempts
          if (attempt > this.config.maxRetries) {
            contextLogger.error('Max retry attempts exceeded', lastError, { 
              totalAttempts: attempt,
              maxRetries: this.config.maxRetries,
            });
            break;
          }

          // Calculate delay for next attempt
          const delay = this.calculateRetryDelay(attempt);
          contextLogger.debug('Waiting before retry', { delay, nextAttempt: attempt + 1 });
          
          await this.sleep(delay);
        }
      }

      // If we get here, all retries failed
      throw lastError || new Error('Operation failed after all retry attempts');
    });
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    circuitBreakerName: string,
    context: Record<string, any> = {}
  ): Promise<T> {
    const circuitBreaker = this.getOrCreateCircuitBreaker(circuitBreakerName);
    const contextLogger = this.logger.child(generateCorrelationId(), { 
      circuitBreaker: circuitBreakerName, 
      ...context 
    });

    try {
      return await circuitBreaker.execute(operation);
    } catch (error) {
      contextLogger.error('Circuit breaker operation failed', error as Error, {
        circuitBreakerStatus: circuitBreaker.getStatus(),
      });
      throw error;
    }
  }

  /**
   * Execute operation with both retry and circuit breaker protection
   */
  async executeWithFullRecovery<T>(
    operation: () => Promise<T>,
    operationName: string,
    context: Record<string, any> = {}
  ): Promise<T> {
    const circuitBreakerName = `${operationName}-circuit-breaker`;
    
    return await this.executeWithCircuitBreaker(
      () => this.executeWithRetry(operation, operationName, context),
      circuitBreakerName,
      context
    );
  }

  /**
   * Get error recovery recommendations based on error type
   */
  getRecoveryRecommendations(error: Error): {
    shouldRetry: boolean;
    suggestedDelay: number;
    recoveryActions: string[];
    errorCategory: ErrorCategory;
  } {
    const shouldRetry = !this.shouldNotRetry(error);
    const errorCategory = this.categorizeError(error);
    const suggestedDelay = this.calculateRetryDelay(1);
    
    const recoveryActions: string[] = [];
    
    if (isQRCodeError(error)) {
      switch (error.code) {
        case 'QR_GENERATION_TIMEOUT':
          recoveryActions.push('Retry with longer timeout', 'Check browser resources');
          break;
        case 'BROWSER_LAUNCH_ERROR':
          recoveryActions.push('Retry with different browser configuration', 'Check system resources');
          break;
        case 'CLIENT_INITIALIZATION_ERROR':
          recoveryActions.push('Clean up existing sessions', 'Restart WhatsApp client');
          break;
        case 'RATE_LIMIT_EXCEEDED':
          recoveryActions.push('Wait before retrying', 'Implement exponential backoff');
          break;
        default:
          recoveryActions.push('Check error details', 'Retry with caution');
      }
    } else {
      recoveryActions.push('Check network connectivity', 'Verify system resources', 'Review error logs');
    }

    return {
      shouldRetry,
      suggestedDelay,
      recoveryActions,
      errorCategory,
    };
  }

  /**
   * Get circuit breaker status for monitoring
   */
  getCircuitBreakerStatuses(): Record<string, any> {
    const statuses: Record<string, any> = {};
    
    for (const [name, circuitBreaker] of this.circuitBreakers) {
      statuses[name] = circuitBreaker.getStatus();
    }
    
    return statuses;
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(name: string): boolean {
    const circuitBreaker = this.circuitBreakers.get(name);
    if (circuitBreaker) {
      // Create new circuit breaker to reset state
      this.circuitBreakers.set(name, new CircuitBreaker(name, this.config, this.logger));
      this.logger.info('Circuit breaker manually reset', { circuitBreaker: name });
      return true;
    }
    return false;
  }

  /**
   * Check if error should not be retried
   */
  private shouldNotRetry(error: Error): boolean {
    if (isQRCodeError(error)) {
      // Don't retry validation errors, authorization errors, or not found errors
      return error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 && error.statusCode !== 429;
    }
    
    // Don't retry certain system errors
    const nonRetryableErrors = [
      'ValidationError',
      'AuthenticationError',
      'AuthorizationError',
      'DeviceNotFoundError',
      'SessionNotFoundError',
    ];
    
    return nonRetryableErrors.includes(error.constructor.name);
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number): number {
    let delay = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attempt - 1);
    delay = Math.min(delay, this.config.maxDelayMs);
    
    if (this.config.useJitter) {
      // Add random jitter (±25%)
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      delay += jitter;
    }
    
    return Math.max(0, Math.floor(delay));
  }

  /**
   * Categorize error for monitoring and recovery
   */
  private categorizeError(error: Error): ErrorCategory {
    if (isQRCodeError(error)) {
      const statusCode = error.statusCode;
      
      if (statusCode >= 400 && statusCode < 500) {
        if (statusCode === 401) return ErrorCategory.AUTHENTICATION;
        if (statusCode === 403) return ErrorCategory.AUTHORIZATION;
        if (statusCode === 404) return ErrorCategory.NOT_FOUND;
        if (statusCode === 408) return ErrorCategory.TIMEOUT;
        if (statusCode === 429) return ErrorCategory.RATE_LIMIT;
        return ErrorCategory.VALIDATION;
      }
      
      if (statusCode >= 500) {
        return ErrorCategory.SERVER_ERROR;
      }
    }
    
    return ErrorCategory.CLIENT_ERROR;
  }

  /**
   * Get or create circuit breaker
   */
  private getOrCreateCircuitBreaker(name: string): CircuitBreaker {
    if (!this.circuitBreakers.has(name)) {
      this.circuitBreakers.set(name, new CircuitBreaker(name, this.config, this.logger));
    }
    return this.circuitBreakers.get(name)!;
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Default error recovery service instance
 */
export const errorRecoveryService = new ErrorRecoveryService();

/**
 * Create error recovery service with custom configuration
 */
export function createErrorRecoveryService(config: Partial<RecoveryConfig> = {}): ErrorRecoveryService {
  return new ErrorRecoveryService(config);
}
