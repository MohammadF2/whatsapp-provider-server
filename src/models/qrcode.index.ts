/**
 * QR Code System Types - Main Export File
 * 
 * This file provides a centralized export point for all QR code system types,
 * interfaces, and error classes.
 */

// Core types and interfaces
export * from './qrcode.types';
export * from './qrcode.interfaces';
export * from './qrcode.responses';
export * from './qrcode.errors';
export * from './qrcode.constants';

// Re-export commonly used types for convenience
export type {
  QRCodeSession,
  SessionStatus,
  ClientConfig,
  WhatsAppClientWrapper
} from './qrcode.types';

export type {
  IQRCodeManager,
  ISessionStore,
  IWhatsAppClientFactory,
  IQRCodeController
} from './qrcode.interfaces';

export type {
  QRCodeResponse,
  StatusResponse,
  ErrorResponse,
  ValidationErrorResponse
} from './qrcode.responses';

// Re-export error classes
export {
  QRCodeError,
  ValidationError,
  DeviceNotFoundError,
  DeviceAlreadyConnectedError,
  SessionNotFoundError,
  SessionExpiredError,
  QRGenerationTimeoutError,
  ClientInitializationError,
  BrowserLaunchError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ResourceCleanupError,
  ConcurrentSessionError,
  isQRCodeError,
  ErrorCategory,
  getErrorCategory
} from './qrcode.errors';