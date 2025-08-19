# QR Code REST API Refactor - Design Document

## Overview

This design document outlines the refactored QR code REST API system that will provide reliable WhatsApp account connection through QR code generation and status monitoring. The solution addresses the current issues with event handling, session management, and API reliability.

## Architecture

### High-Level Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   REST Client   │───▶│  QR Code API     │───▶│  QR Code Manager    │
│                 │    │  Controller      │    │                     │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
                                │                          │
                                ▼                          ▼
                       ┌──────────────────┐    ┌─────────────────────┐
                       │  Session Store   │    │  WhatsApp Client    │
                       │                  │    │  Factory            │
                       └──────────────────┘    └─────────────────────┘
                                                          │
                                                          ▼
                                               ┌─────────────────────┐
                                               │  WhatsApp Web.js    │
                                               │  / Selenium Client  │
                                               └─────────────────────┘
```

### Component Interaction Flow

1. **REST API Request** → QR Code Controller
2. **Controller** → QR Code Manager (creates session)
3. **QR Code Manager** → WhatsApp Client Factory
4. **Client Factory** → WhatsApp Web.js/Selenium Client
5. **WhatsApp Client** → QR Event → QR Code Manager
6. **QR Code Manager** → Session Store (stores QR data)
7. **Controller** → Returns QR code to client

## Components and Interfaces

### 1. QR Code Manager Service

**Purpose:** Central service for managing QR code generation sessions and WhatsApp client lifecycle.

**Interface:**
```typescript
interface QRCodeManager {
  generateQRCode(deviceId: string, userId: string): Promise<QRCodeSession>;
  getSessionStatus(sessionId: string): Promise<SessionStatus>;
  cleanupExpiredSessions(): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
}

interface QRCodeSession {
  sessionId: string;
  deviceId: string;
  userId: string;
  qrCode?: string;
  status: 'pending' | 'generated' | 'scanned' | 'connected' | 'expired' | 'failed';
  createdAt: Date;
  expiresAt: Date;
  error?: string;
}
```

**Key Features:**
- Session-based QR code management
- Automatic cleanup of expired sessions
- Support for both Puppeteer and Selenium clients
- Thread-safe operations with proper locking
- Comprehensive error handling and logging

### 2. Session Store

**Purpose:** In-memory store for active QR code sessions with automatic cleanup.

**Interface:**
```typescript
interface SessionStore {
  createSession(deviceId: string, userId: string): QRCodeSession;
  getSession(sessionId: string): QRCodeSession | null;
  updateSession(sessionId: string, updates: Partial<QRCodeSession>): void;
  deleteSession(sessionId: string): void;
  getExpiredSessions(): QRCodeSession[];
  cleanup(): void;
}
```

**Implementation Details:**
- Map-based storage for fast lookups
- Automatic expiration handling (60-second default)
- Memory-efficient cleanup process
- Thread-safe operations

### 3. WhatsApp Client Factory

**Purpose:** Factory for creating and managing WhatsApp client instances with proper event handling.

**Interface:**
```typescript
interface WhatsAppClientFactory {
  createClient(deviceId: string, config: ClientConfig): Promise<WhatsAppClientWrapper>;
  destroyClient(deviceId: string): Promise<void>;
}

interface WhatsAppClientWrapper {
  client: Client;
  deviceId: string;
  onQR(callback: (qr: string) => void): void;
  onReady(callback: (info: any) => void): void;
  onDisconnected(callback: (reason: string) => void): void;
  onError(callback: (error: Error) => void): void;
  initialize(): Promise<void>;
  destroy(): Promise<void>;
}
```

**Key Features:**
- Abstraction over WhatsApp Web.js and Selenium implementations
- Proper event handling with callback registration
- Resource cleanup and error handling
- Support for different browser configurations

### 4. Enhanced QR Code Controller

**Purpose:** REST API endpoints with improved error handling and response consistency.

**Interface:**
```typescript
interface QRCodeController {
  generateQRCode(req: Request, res: Response): Promise<void>;
  checkQRCodeStatus(req: Request, res: Response): Promise<void>;
}
```

**Response Schemas:**
```typescript
interface QRCodeResponse {
  success: boolean;
  qrCode?: string;
  sessionId?: string;
  deviceId?: string;
  expiresIn?: number;
  message?: string;
  error?: string;
}

interface StatusResponse {
  success: boolean;
  status: 'pending' | 'generated' | 'scanned' | 'connected' | 'expired' | 'failed';
  message?: string;
  error?: string;
}
```

## Data Models

### QR Code Session Model

```typescript
interface QRCodeSession {
  sessionId: string;           // Unique session identifier
  deviceId: string;           // Associated device ID
  userId: string;             // User who owns the device
  qrCode?: string;            // Base64 QR code data URL
  status: SessionStatus;      // Current session status
  createdAt: Date;           // Session creation time
  expiresAt: Date;           // Session expiration time
  lastUpdated: Date;         // Last status update
  error?: string;            // Error message if failed
  clientType: 'puppeteer' | 'selenium'; // Client implementation type
}

type SessionStatus = 
  | 'pending'      // Session created, waiting for QR
  | 'generated'    // QR code generated and ready
  | 'scanned'      // QR code scanned by user
  | 'connected'    // Successfully connected
  | 'expired'      // Session expired
  | 'failed';      // Session failed with error
```

### Client Configuration Model

```typescript
interface ClientConfig {
  deviceId: string;
  clientType: 'puppeteer' | 'selenium';
  seleniumConfig?: {
    browserType: 'chrome' | 'firefox';
    headless: boolean;
    userAgent?: string;
  };
  timeouts: {
    qrGeneration: number;    // Default: 30000ms
    connection: number;      // Default: 60000ms
    initialization: number;  // Default: 120000ms
  };
}
```

## Error Handling

### Error Categories

1. **Validation Errors** (400)
   - Invalid device ID
   - Device not found
   - Device already connected
   - Invalid session ID

2. **Authentication Errors** (401)
   - Invalid JWT token
   - Device doesn't belong to user

3. **Timeout Errors** (408)
   - QR code generation timeout
   - Client initialization timeout

4. **Server Errors** (500)
   - WhatsApp client initialization failure
   - Browser launch failure
   - Unexpected errors

### Error Response Format

```typescript
interface ErrorResponse {
  success: false;
  message: string;
  error?: string;
  code?: string;
  details?: any;
}
```

### Retry Strategy

- **QR Generation Failures**: Automatic retry up to 3 times with exponential backoff
- **Browser Launch Failures**: Single retry with different configuration
- **Network Timeouts**: No automatic retry, return timeout error
- **Session Conflicts**: Clean up existing session and retry once

## Testing Strategy

### Unit Tests

1. **QR Code Manager Tests**
   - Session creation and management
   - QR code generation flow
   - Error handling scenarios
   - Cleanup operations

2. **Session Store Tests**
   - CRUD operations
   - Expiration handling
   - Memory management
   - Concurrent access

3. **Client Factory Tests**
   - Client creation for different configurations
   - Event handling
   - Resource cleanup
   - Error scenarios

4. **Controller Tests**
   - Request validation
   - Response formatting
   - Error handling
   - Authentication

### Integration Tests

1. **End-to-End QR Flow**
   - Generate QR code
   - Check status updates
   - Handle successful connection
   - Handle expiration

2. **Multi-Device Scenarios**
   - Concurrent QR generation
   - Session isolation
   - Resource management

3. **Error Recovery**
   - Browser crash handling
   - Network interruption recovery
   - Session cleanup after failures

### Performance Tests

1. **Load Testing**
   - Multiple concurrent QR requests
   - Memory usage under load
   - Response time benchmarks

2. **Stress Testing**
   - Resource exhaustion scenarios
   - Recovery after failures
   - Long-running session management

## Implementation Phases

### Phase 1: Core Infrastructure
- Implement QR Code Manager service
- Create Session Store with basic operations
- Set up proper logging and error handling

### Phase 2: Client Factory
- Implement WhatsApp Client Factory
- Add support for both Puppeteer and Selenium
- Implement proper event handling

### Phase 3: API Integration
- Refactor QR Code Controller
- Update API endpoints
- Implement proper response formatting

### Phase 4: Testing and Optimization
- Add comprehensive test suite
- Performance optimization
- Documentation updates

### Phase 5: Deployment and Monitoring
- Add monitoring and metrics
- Deploy with proper configuration
- Monitor performance and errors

## Security Considerations

1. **Session Security**
   - Sessions are tied to authenticated users
   - Session IDs are cryptographically secure UUIDs
   - Automatic cleanup prevents session leakage

2. **Resource Protection**
   - Rate limiting on QR generation endpoints
   - Maximum concurrent sessions per user
   - Automatic cleanup of abandoned sessions

3. **Error Information**
   - Sanitized error messages in responses
   - Detailed logging for debugging
   - No sensitive information in client responses

## Monitoring and Observability

1. **Metrics**
   - QR code generation success rate
   - Average generation time
   - Session lifecycle metrics
   - Error rates by category

2. **Logging**
   - Structured logging with correlation IDs
   - Performance timing logs
   - Error logs with stack traces
   - Session lifecycle events

3. **Health Checks**
   - QR generation endpoint health
   - Session store health
   - WhatsApp client factory health
   - Overall system health endpoint