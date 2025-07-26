/**
 * QR Code System Error Types
 * 
 * This file contains custom error classes and types for the QR code
 * generation and session management system.
 */

/**
 * Base error class for QR code operations
 */
export abstract class QRCodeError extends Error {
  /** HTTP status code for this error */
  public readonly statusCode: number;
  
  /** Error code for programmatic handling */
  public readonly code: string;
  
  /** Additional error details */
  public readonly details?: any;

  constructor(message: string, statusCode: number, code: string, details?: any) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    
    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error for invalid input parameters
 */
export class ValidationError extends QRCodeError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

/**
 * Device not found error
 */
export class DeviceNotFoundError extends QRCodeError {
  constructor(deviceId: string) {
    super(`Device with ID ${deviceId} not found`, 404, 'DEVICE_NOT_FOUND', { deviceId });
  }
}

/**
 * Device already connected error
 */
export class DeviceAlreadyConnectedError extends QRCodeError {
  constructor(deviceId: string) {
    super(`Device ${deviceId} is already connected to WhatsApp`, 400, 'DEVICE_ALREADY_CONNECTED', { deviceId });
  }
}

/**
 * Session not found error
 */
export class SessionNotFoundError extends QRCodeError {
  constructor(sessionId: string) {
    super(`QR code session ${sessionId} not found`, 404, 'SESSION_NOT_FOUND', { sessionId });
  }
}

/**
 * Session expired error
 */
export class SessionExpiredError extends QRCodeError {
  constructor(sessionId: string) {
    super(`QR code session ${sessionId} has expired`, 410, 'SESSION_EXPIRED', { sessionId });
  }
}

/**
 * QR code generation timeout error
 */
export class QRGenerationTimeoutError extends QRCodeError {
  constructor(deviceId: string, timeout: number) {
    super(`QR code generation timed out after ${timeout}ms for device ${deviceId}`, 408, 'QR_GENERATION_TIMEOUT', { 
      deviceId, 
      timeout 
    });
  }
}

/**
 * Client initialization error
 */
export class ClientInitializationError extends QRCodeError {
  constructor(deviceId: string, reason: string) {
    super(`Failed to initialize WhatsApp client for device ${deviceId}: ${reason}`, 500, 'CLIENT_INITIALIZATION_ERROR', { 
      deviceId, 
      reason 
    });
  }
}

/**
 * Browser launch error
 */
export class BrowserLaunchError extends QRCodeError {
  constructor(browserType: string, reason: string) {
    super(`Failed to launch ${browserType} browser: ${reason}`, 500, 'BROWSER_LAUNCH_ERROR', { 
      browserType, 
      reason 
    });
  }
}

/**
 * Authentication error for unauthorized access
 */
export class AuthenticationError extends QRCodeError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * Authorization error for forbidden access
 */
export class AuthorizationError extends QRCodeError {
  constructor(message: string = 'Access forbidden') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/**
 * Rate limit exceeded error
 */
export class RateLimitError extends QRCodeError {
  constructor(limit: number, windowMs: number) {
    super(`Rate limit exceeded: ${limit} requests per ${windowMs}ms`, 429, 'RATE_LIMIT_EXCEEDED', { 
      limit, 
      windowMs 
    });
  }
}

/**
 * Resource cleanup error
 */
export class ResourceCleanupError extends QRCodeError {
  constructor(resource: string, reason: string) {
    super(`Failed to cleanup ${resource}: ${reason}`, 500, 'RESOURCE_CLEANUP_ERROR', { 
      resource, 
      reason 
    });
  }
}

/**
 * Concurrent session error
 */
export class ConcurrentSessionError extends QRCodeError {
  constructor(deviceId: string) {
    super(`Device ${deviceId} already has an active QR code session`, 409, 'CONCURRENT_SESSION_ERROR', { deviceId });
  }
}

/**
 * Type guard to check if an error is a QRCodeError
 */
export function isQRCodeError(error: any): error is QRCodeError {
  return error instanceof QRCodeError;
}

/**
 * Error category enumeration for logging and monitoring
 */
export enum ErrorCategory {
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  NOT_FOUND = 'not_found',
  TIMEOUT = 'timeout',
  CLIENT_ERROR = 'client_error',
  SERVER_ERROR = 'server_error',
  RATE_LIMIT = 'rate_limit',
  RESOURCE_ERROR = 'resource_error'
}

/**
 * Get error category for monitoring and logging
 */
export function getErrorCategory(error: QRCodeError): ErrorCategory {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return ErrorCategory.VALIDATION;
    case 'AUTHENTICATION_ERROR':
      return ErrorCategory.AUTHENTICATION;
    case 'AUTHORIZATION_ERROR':
      return ErrorCategory.AUTHORIZATION;
    case 'DEVICE_NOT_FOUND':
    case 'SESSION_NOT_FOUND':
      return ErrorCategory.NOT_FOUND;
    case 'QR_GENERATION_TIMEOUT':
      return ErrorCategory.TIMEOUT;
    case 'DEVICE_ALREADY_CONNECTED':
    case 'SESSION_EXPIRED':
    case 'CONCURRENT_SESSION_ERROR':
      return ErrorCategory.CLIENT_ERROR;
    case 'RATE_LIMIT_EXCEEDED':
      return ErrorCategory.RATE_LIMIT;
    case 'CLIENT_INITIALIZATION_ERROR':
    case 'BROWSER_LAUNCH_ERROR':
    case 'RESOURCE_CLEANUP_ERROR':
      return ErrorCategory.SERVER_ERROR;
    default:
      return ErrorCategory.SERVER_ERROR;
  }
}

/**
 * Network-related error
 */
export class NetworkError extends QRCodeError {
  constructor(message: string, code: string = 'NETWORK_ERROR') {
    super(message, 500, code);
    this.name = 'NetworkError';
  }
}