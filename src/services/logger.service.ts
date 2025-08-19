/**
 * Centralized Logging Service
 * 
 * Provides structured logging with correlation IDs, performance timing,
 * error categorization, and comprehensive context tracking for the QR code system.
 */

import { v4 as uuidv4 } from 'uuid';
import { ErrorCategory, QRCodeError, isQRCodeError } from '../models/qrcode.errors';

/**
 * Log levels enumeration
 */
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
  TRACE = 'trace'
}

/**
 * Log entry interface
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  correlationId?: string;
  userId?: string;
  deviceId?: string;
  sessionId?: string;
  operation?: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
    category?: ErrorCategory;
    statusCode?: number;
    details?: any;
  };
  context?: Record<string, any>;
  performance?: {
    startTime: number;
    endTime: number;
    duration: number;
    operation: string;
  };
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  level: LogLevel;
  
  /** Whether to enable console output */
  enableConsole: boolean;
  
  /** Whether to enable structured JSON output */
  enableStructured: boolean;
  
  /** Whether to include stack traces in error logs */
  includeStackTrace: boolean;
  
  /** Maximum length for log messages */
  maxMessageLength: number;
  
  /** Whether to enable performance timing logs */
  enablePerformanceLogs: boolean;
  
  /** Service name for log entries */
  serviceName: string;
}

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: LoggerConfig = {
  level: LogLevel.INFO,
  enableConsole: true,
  enableStructured: true,
  includeStackTrace: true,
  maxMessageLength: 1000,
  enablePerformanceLogs: true,
  serviceName: 'QRCodeSystem',
};

/**
 * Performance timer for tracking operation durations
 */
export class PerformanceTimer {
  private startTime: number;
  private operation: string;
  private correlationId?: string;

  constructor(operation: string, correlationId?: string) {
    this.operation = operation;
    this.correlationId = correlationId;
    this.startTime = performance.now();
  }

  /**
   * End the timer and return performance data
   */
  end(): { duration: number; startTime: number; endTime: number; operation: string } {
    const endTime = performance.now();
    const duration = endTime - this.startTime;
    
    return {
      startTime: this.startTime,
      endTime,
      duration,
      operation: this.operation,
    };
  }

  /**
   * Get current elapsed time without ending the timer
   */
  elapsed(): number {
    return performance.now() - this.startTime;
  }
}

/**
 * Centralized Logger Service
 */
export class Logger {
  private config: LoggerConfig;
  private correlationId?: string;
  private context: Record<string, any> = {};

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a child logger with a correlation ID
   */
  child(correlationId: string, context: Record<string, any> = {}): Logger {
    const childLogger = new Logger(this.config);
    childLogger.correlationId = correlationId;
    childLogger.context = { ...this.context, ...context };
    return childLogger;
  }

  /**
   * Set context for all subsequent log entries
   */
  setContext(context: Record<string, any>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clear context
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Start a performance timer
   */
  startTimer(operation: string): PerformanceTimer {
    return new PerformanceTimer(operation, this.correlationId);
  }

  /**
   * Log an info message
   */
  info(message: string, context: Record<string, any> = {}): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context: Record<string, any> = {}): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error | QRCodeError, context: Record<string, any> = {}): void {
    const errorContext = error ? this.formatError(error) : undefined;
    this.log(LogLevel.ERROR, message, { ...context, error: errorContext });
  }

  /**
   * Log a debug message
   */
  debug(message: string, context: Record<string, any> = {}): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log a trace message
   */
  trace(message: string, context: Record<string, any> = {}): void {
    this.log(LogLevel.TRACE, message, context);
  }

  /**
   * Log performance timing
   */
  performance(timer: PerformanceTimer, message?: string): void {
    if (!this.config.enablePerformanceLogs) {
      return;
    }

    const perfData = timer.end();
    const logMessage = message || `Operation '${perfData.operation}' completed`;
    
    this.log(LogLevel.INFO, logMessage, {
      performance: perfData,
      operation: perfData.operation,
      duration: perfData.duration,
    });
  }

  /**
   * Log with performance timing in a single call
   */
  async withTiming<T>(operation: string, fn: () => Promise<T>, context: Record<string, any> = {}): Promise<T> {
    const timer = this.startTimer(operation);
    
    try {
      const result = await fn();
      this.performance(timer, `${operation} completed successfully`);
      return result;
    } catch (error) {
      const perfData = timer.end();
      this.error(`${operation} failed after ${perfData.duration.toFixed(2)}ms`, error as Error, {
        ...context,
        performance: perfData,
        operation,
      });
      throw error;
    }
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, context: Record<string, any> = {}): void {
    // Check if log level is enabled
    if (!this.shouldLog(level)) {
      return;
    }

    // Truncate message if too long
    const truncatedMessage = message.length > this.config.maxMessageLength
      ? message.substring(0, this.config.maxMessageLength) + '...'
      : message;

    // Create log entry
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.config.serviceName,
      message: truncatedMessage,
      correlationId: this.correlationId,
      ...this.extractStandardFields(context),
      context: this.sanitizeContext({ ...this.context, ...context }),
    };

    // Output log entry
    this.output(logEntry);
  }

  /**
   * Format error for logging
   */
  private formatError(error: Error | QRCodeError): LogEntry['error'] {
    const errorInfo: LogEntry['error'] = {
      name: error.name,
      message: error.message,
    };

    if (this.config.includeStackTrace && error.stack) {
      errorInfo.stack = error.stack;
    }

    if (isQRCodeError(error)) {
      errorInfo.code = error.code;
      errorInfo.statusCode = error.statusCode;
      errorInfo.details = error.details;
      errorInfo.category = this.getErrorCategory(error);
    }

    return errorInfo;
  }

  /**
   * Get error category for QR code errors
   */
  private getErrorCategory(error: QRCodeError): ErrorCategory {
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
    
    return ErrorCategory.CLIENT_ERROR;
  }

  /**
   * Extract standard fields from context
   */
  private extractStandardFields(context: Record<string, any>): Partial<LogEntry> {
    const fields: Partial<LogEntry> = {};
    
    if (context.userId) fields.userId = context.userId;
    if (context.deviceId) fields.deviceId = context.deviceId;
    if (context.sessionId) fields.sessionId = context.sessionId;
    if (context.operation) fields.operation = context.operation;
    if (context.duration) fields.duration = context.duration;
    if (context.performance) fields.performance = context.performance;
    if (context.error) fields.error = context.error;
    
    return fields;
  }

  /**
   * Sanitize context to remove sensitive information
   */
  private sanitizeContext(context: Record<string, any>): Record<string, any> {
    const sanitized = { ...context };
    
    // Remove standard fields that are already extracted
    delete sanitized.userId;
    delete sanitized.deviceId;
    delete sanitized.sessionId;
    delete sanitized.operation;
    delete sanitized.duration;
    delete sanitized.performance;
    delete sanitized.error;
    
    // Remove sensitive fields
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.secret;
    delete sanitized.key;
    
    return sanitized;
  }

  /**
   * Check if log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG, LogLevel.TRACE];
    const currentLevelIndex = levels.indexOf(this.config.level);
    const messageLevelIndex = levels.indexOf(level);
    
    return messageLevelIndex <= currentLevelIndex;
  }

  /**
   * Output log entry to configured destinations
   */
  private output(logEntry: LogEntry): void {
    if (this.config.enableConsole) {
      this.outputToConsole(logEntry);
    }
    
    if (this.config.enableStructured) {
      this.outputStructured(logEntry);
    }
  }

  /**
   * Output to console with formatting
   */
  private outputToConsole(logEntry: LogEntry): void {
    const { timestamp, level, service, message, correlationId, deviceId, sessionId } = logEntry;
    
    const prefix = `[${timestamp}] [${service}] [${level.toUpperCase()}]`;
    const ids = [correlationId, deviceId, sessionId].filter(Boolean).join(' | ');
    const idsStr = ids ? ` [${ids}]` : '';
    
    const logMessage = `${prefix}${idsStr} ${message}`;
    
    switch (level) {
      case LogLevel.ERROR:
        console.error(logMessage, logEntry.error || '');
        break;
      case LogLevel.WARN:
        console.warn(logMessage);
        break;
      case LogLevel.DEBUG:
      case LogLevel.TRACE:
        console.debug(logMessage, logEntry.context || '');
        break;
      default:
        console.log(logMessage);
    }
  }

  /**
   * Output structured JSON log
   */
  private outputStructured(logEntry: LogEntry): void {
    // In a production environment, this could write to a file, 
    // send to a logging service, or store in a database
    console.log(JSON.stringify(logEntry));
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Create a logger for a specific service
 */
export function createLogger(serviceName: string, config: Partial<LoggerConfig> = {}): Logger {
  return new Logger({
    ...config,
    serviceName,
  });
}

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return uuidv4();
}
