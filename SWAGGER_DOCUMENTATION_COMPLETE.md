# WhatsApp API Provider - Complete Swagger Documentation

## Overview

The Swagger documentation has been fully updated to include all endpoints with comprehensive OpenAPI 3.0 specifications.

## Access Documentation

- **Swagger UI**: Available at `/api-docs` when the server is running
- **OpenAPI JSON**: Available at `/api-docs.json`

## Documentation Features

### 🔐 Authentication

- JWT Bearer token authentication documented
- Security schemes properly configured
- Authentication requirements specified for each endpoint

### 📊 Comprehensive Schemas

All data models are fully documented with:

- Request/response schemas
- Property types and descriptions
- Example values
- Validation rules
- Enum values where applicable

### 🏷️ Organized Tags

API endpoints are organized into logical groups:

- **System** - Health checks and API information
- **Auth** - User authentication
- **Devices** - Device management
- **WhatsApp** - Messaging operations
- **Conversations** - Chat and message management
- **Message History** - Message tracking
- **Contacts** - Contact operations
- **QRCode** - Authentication QR codes

### 📝 Detailed Endpoints

#### System (`/api`)

- `GET /` - API health check and information

#### Authentication (`/api/auth`)

- `POST /register` - User registration
- `POST /login` - User login
- `GET /profile` - Get user profile

#### Device Management (`/api/devices`)

- `POST /` - Create device
- `GET /` - List user devices
- `GET /:id` - Get device details
- `PUT /:id` - Update device
- `DELETE /:id` - Delete device

#### WhatsApp Operations (`/api/whatsapp`)

- `GET /test/:deviceId` - Test connection
- `POST /send` - Send message (legacy)
- `POST /send-message` - Send text message
- `POST /send-file` - Send file/media
- `POST /send-location` - Send location
- `POST /send-contact` - Send contact
- `POST /disconnect/:deviceId` - Disconnect device

#### Conversations (`/api/whatsapp`)

- `GET /conversations/:deviceId` - Get conversations
- `GET /messages/:deviceId/:chatId` - Get messages
- `POST /read/:deviceId/:chatId` - Mark as read

#### Message History (`/api/message-history`)

- `GET /` - Get message history (with filtering)
- `GET /device/:deviceId` - Get device message history

#### Contacts (`/api/contacts`)

- `GET /check-blocked/:deviceId/:phoneNumber` - Check if blocked

#### QR Code (`/api/qrcode`)

- `GET /generate/:deviceId` - Generate QR code
- `GET /status/:deviceId/:sessionId` - Check QR status

### 🔄 Response Standards

Standardized response formats:

- Success responses with consistent structure
- Error responses with proper HTTP status codes
- Pagination information for list endpoints
- Detailed error messages and validation feedback

### 📋 Request/Response Examples

Every endpoint includes:

- Complete request examples
- Response schema definitions
- Error response examples
- Parameter descriptions
- Query parameter options

### 🛠️ Advanced Features

- File upload specifications for media endpoints
- WebSocket event documentation
- Custom error response schemas
- Reusable components for common data types
- Proper HTTP status code documentation

## Key Improvements Made

1. **Complete Coverage**: All 20+ endpoints now have full Swagger documentation
2. **Rich Schemas**: Detailed data models for all request/response objects
3. **Better Organization**: Logical grouping with tags and descriptions
4. **Enhanced UX**: Improved API description with usage examples
5. **Error Handling**: Comprehensive error response documentation
6. **Security**: Proper JWT authentication documentation
7. **Validation**: Input validation rules and constraints
8. **Examples**: Real-world examples for all endpoints

## Usage

1. Start the server: `npm run dev` or `npm start`
2. Open browser to `http://localhost:3000/api-docs`
3. Explore the interactive API documentation
4. Test endpoints directly from the Swagger UI
5. Use the "Authorize" button to add your JWT token

The documentation now provides a complete reference for developers integrating with the WhatsApp API Provider, making it easy to understand and use all available functionality.
