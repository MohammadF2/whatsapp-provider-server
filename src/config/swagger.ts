import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'WhatsApp API Provider',
      version: '1.0.0',
      description: `
        A comprehensive WhatsApp API Provider that allows you to manage multiple WhatsApp devices, 
        send messages, handle conversations, and manage contacts through a REST API and WebSocket interface.
        
        ## Features
        - Multi-device WhatsApp management
        - Support for both Puppeteer and Selenium WebDriver
        - Real-time communication via WebSocket
        - Message history tracking
        - File uploads and media messages
        - Location and contact sharing
        - QR code authentication with session management
        - Session persistence and automatic cleanup
        - Rate limiting and performance monitoring
        - Comprehensive error handling and recovery
        - Health monitoring and metrics collection
        - Timeout management and retry strategies
        
        ## Authentication
        Most endpoints require JWT authentication. Include the token in the Authorization header:
        \`Authorization: Bearer <your-jwt-token>\`
        
        ## WebSocket Events
        Connect to the WebSocket endpoint for real-time updates:
        - \`whatsapp:qr\` - QR code for device authentication
        - \`whatsapp:ready\` - Device connected successfully
        - \`whatsapp:disconnected\` - Device disconnected
        - \`whatsapp:error\` - Connection errors
      `,
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
      contact: {
        name: 'WhatsApp API Provider Support',
        url: 'https://github.com/your-repo',
        email: 'support@example.com',
      },
    },
    servers: [
      {
        url: '/api',
        description: 'API Base URL',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from the login endpoint',
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication information is missing or invalid',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    example: 'Unauthorized'
                  }
                }
              }
            }
          }
        },
        NotFoundError: {
          description: 'The requested resource was not found',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    example: 'Resource not found'
                  }
                }
              }
            }
          }
        },
        ValidationError: {
          description: 'Validation error in request data',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    example: 'Validation failed'
                  },
                  errors: {
                    type: 'array',
                    items: {
                      type: 'string'
                    }
                  }
                }
              }
            }
          }
        },
        ServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    example: 'Internal server error'
                  },
                  error: {
                    type: 'string'
                  }
                }
              }
            }
          }
        },
        RateLimitExceeded: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/RateLimitResponse'
              }
            }
          }
        },
        EnhancedError: {
          description: 'Enhanced error response with detailed information',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/EnhancedErrorResponse'
              }
            }
          }
        }
      },
      schemas: {
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              example: 'Operation completed successfully'
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              example: 'An error occurred'
            },
            error: {
              type: 'string',
              description: 'Detailed error message'
            }
          }
        },
        PaginationInfo: {
          type: 'object',
          properties: {
            page: {
              type: 'integer',
              description: 'Current page number',
              example: 1
            },
            limit: {
              type: 'integer',
              description: 'Number of items per page',
              example: 50
            },
            total: {
              type: 'integer',
              description: 'Total number of items',
              example: 150
            },
            pages: {
              type: 'integer',
              description: 'Total number of pages',
              example: 3
            }
          }
        },
        PhoneNumber: {
          type: 'string',
          pattern: '^[0-9+\\-\\s()]+$',
          description: 'Phone number in international format',
          example: '+1234567890'
        },
        ChatId: {
          type: 'string',
          description: 'WhatsApp chat ID (phone@c.us for individual, groupId@g.us for groups)',
          example: '1234567890@c.us'
        },
        MessageId: {
          type: 'string',
          description: 'WhatsApp message ID',
          example: 'ABCDEF1234567890_1234567890@c.us'
        },
        DeviceStatus: {
          type: 'string',
          enum: ['disconnected', 'connecting', 'connected'],
          description: 'Device connection status'
        },
        MessageType: {
          type: 'string',
          enum: ['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'sticker', 'voice'],
          description: 'Type of message content'
        },
        MessageStatus: {
          type: 'string',
          enum: ['sent', 'failed', 'pending'],
          description: 'Status of sent message'
        },
        SessionStatus: {
          type: 'string',
          enum: ['pending', 'generated', 'connected', 'failed', 'expired', 'cancelled'],
          description: 'QR code session status'
        },
        ErrorCategory: {
          type: 'string',
          enum: ['validation', 'authentication', 'authorization', 'not_found', 'timeout', 'client_error', 'server_error', 'rate_limit', 'resource_error'],
          description: 'Error category for better error handling'
        },
        HealthStatus: {
          type: 'string',
          enum: ['healthy', 'degraded', 'unhealthy', 'critical'],
          description: 'System health status'
        },
        RateLimitResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'string',
              example: 'Rate limit exceeded'
            },
            message: {
              type: 'string',
              example: 'Too many requests. Please try again later.'
            },
            retryAfter: {
              type: 'integer',
              description: 'Seconds to wait before retrying',
              example: 60
            },
            remainingRequests: {
              type: 'integer',
              description: 'Number of remaining requests in current window',
              example: 0
            }
          }
        },
        EnhancedErrorResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              description: 'Human-readable error message'
            },
            error: {
              type: 'string',
              description: 'Error code for programmatic handling'
            },
            category: {
              $ref: '#/components/schemas/ErrorCategory'
            },
            details: {
              type: 'object',
              description: 'Additional error details',
              additionalProperties: true
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'When the error occurred'
            },
            correlationId: {
              type: 'string',
              description: 'Unique identifier for tracking this request',
              example: 'abc123-def456-ghi789'
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'System',
        description: 'System health and information endpoints'
      },
      {
        name: 'Auth',
        description: 'User authentication and authorization'
      },
      {
        name: 'Devices',
        description: 'WhatsApp device management'
      },
      {
        name: 'WhatsApp',
        description: 'WhatsApp messaging operations'
      },
      {
        name: 'Conversations',
        description: 'WhatsApp conversations and messages'
      },
      {
        name: 'Message History',
        description: 'Message history and tracking'
      },
      {
        name: 'Contacts',
        description: 'Contact operations and management'
      },
      {
        name: 'QRCode',
        description: 'QR code generation and authentication'
      }
    ],
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: [
    './src/routes/*.ts',
    './src/controllers/*.ts',
    './src/models/*.ts',
  ],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
