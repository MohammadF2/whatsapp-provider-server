# QR Code System Types and Interfaces

This directory contains the core TypeScript type definitions, interfaces, and error classes for the QR code generation and session management system.

## Files Overview

### Core Types (`qrcode.types.ts`)
- `SessionStatus` - Enumeration of possible QR code session states
- `QRCodeSession` - Interface representing an active QR authentication session
- `ClientConfig` - Configuration interface for WhatsApp client initialization
- `WhatsAppClientWrapper` - Interface for abstracting different client implementations

### Service Interfaces (`qrcode.interfaces.ts`)
- `IQRCodeManager` - Central service for managing QR code sessions
- `ISessionStore` - In-memory store for active sessions
- `IWhatsAppClientFactory` - Factory for creating WhatsApp clients
- `IQRCodeController` - REST API controller interface

### API Response Schemas (`qrcode.responses.ts`)
- `BaseResponse` - Base interface for all API responses
- `QRCodeResponse` - Response schema for QR code generation
- `StatusResponse` - Response schema for status checks
- `ErrorResponse` - Error response schema
- `ValidationErrorResponse` - Validation error response schema

### Error Classes (`qrcode.errors.ts`)
- `QRCodeError` - Base error class for all QR code operations
- Specific error classes for different failure scenarios:
  - `ValidationError`
  - `DeviceNotFoundError`
  - `DeviceAlreadyConnectedError`
  - `SessionNotFoundError`
  - `SessionExpiredError`
  - `QRGenerationTimeoutError`
  - `ClientInitializationError`
  - `BrowserLaunchError`
  - `AuthenticationError`
  - `AuthorizationError`
  - `RateLimitError`
  - `ResourceCleanupError`
  - `ConcurrentSessionError`

### Constants (`qrcode.constants.ts`)
- `DEFAULT_TIMEOUTS` - Default timeout values for various operations
- `SYSTEM_TIMEOUTS` - Additional system timeout values
- `RATE_LIMITS` - Rate limiting configuration
- `VALID_STATUS_TRANSITIONS` - Valid session status transitions
- `HTTP_STATUS_CODES` - HTTP status codes for different scenarios
- `LOG_LEVELS` - Log levels for different operations
- `EVENTS` - Event names for internal system events
- `DEFAULT_CLIENT_CONFIG` - Default client configuration
- `VALIDATION` - Validation constraints
- `MEMORY_LIMITS` - Memory usage limits

### Main Export (`qrcode.index.ts`)
Centralized export point for all QR code system types, interfaces, and classes.

## Usage

```typescript
import {
  QRCodeSession,
  SessionStatus,
  ClientConfig,
  QRCodeResponse,
  ValidationError,
  DEFAULT_TIMEOUTS,
  IQRCodeManager
} from './qrcode.index';

// Create a session
const session: QRCodeSession = {
  sessionId: 'uuid-here',
  deviceId: 'device-123',
  userId: 'user-456',
  status: 'pending',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + DEFAULT_TIMEOUTS.qrGeneration),
  lastUpdated: new Date(),
  clientType: 'puppeteer'
};

// Handle errors
try {
  // Some operation
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation error
  }
}
```

## Requirements Satisfied

This implementation satisfies the following requirements from the specification:

- **Requirement 1.1**: QR code generation API with proper response schemas
- **Requirement 1.5**: QR code expiration time and session ID handling
- **Requirement 7.1**: Standard API response format
- **Requirement 7.4**: Appropriate HTTP status codes
- **Requirement 7.5**: Response schemas matching Swagger documentation

## Next Steps

These types and interfaces will be used by:
1. Session Store service (Task 2)
2. QR Code Manager service (Task 3)
3. WhatsApp Client Factory (Task 4)
4. Updated QR Code Controller (Task 7)