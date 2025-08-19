import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Proxy configuration interface
 */
export interface ProxyConfig {
  decodo: {
    enabled: boolean;
    username: string;
    password: string;
    endpoint: string;
    port: number;
    connectionTimeoutMs: number;
    requestTimeoutMs: number;
    maxRetries: number;
    retryDelayMs: number;
    healthCheckIntervalMs: number;
    healthCheckTimeoutMs: number;
    enableLogging: boolean;
  };
  messageQueue: {
    enabled: boolean;
    maxQueueSize: number;
    messagesPerMinute: number;
    messageDelayMs: number;
    maxRetryAttempts: number;
    retryDelayMultiplier: number;
    maxRetryDelayMs: number;
    processingIntervalMs: number;
    enableLogging: boolean;
  };
  countryMapping: {
    [key: string]: string;
  };
  rateLimiting: {
    enabled: boolean;
    windowMs: number;
    maxRequests: number;
    skipSuccessfulRequests: boolean;
    skipFailedRequests: boolean;
  };
  monitoring: {
    enabled: boolean;
    metricsIntervalMs: number;
    healthCheckIntervalMs: number;
    alertThresholds: {
      errorRate: number;
      responseTime: number;
      queueSize: number;
    };
  };
}

/**
 * Default proxy configuration
 */
const defaultConfig: ProxyConfig = {
  decodo: {
    enabled: process.env.DECODO_ENABLED === 'true',
    username: process.env.DECODO_USERNAME || '',
    password: process.env.DECODO_PASSWORD || '',
    endpoint: process.env.DECODO_ENDPOINT || 'gate.decodo.com',
    port: parseInt(process.env.DECODO_PORT || '10000'),
    connectionTimeoutMs: parseInt(process.env.DECODO_CONNECTION_TIMEOUT || '30000'),
    requestTimeoutMs: parseInt(process.env.DECODO_REQUEST_TIMEOUT || '60000'),
    maxRetries: parseInt(process.env.DECODO_MAX_RETRIES || '3'),
    retryDelayMs: parseInt(process.env.DECODO_RETRY_DELAY || '2000'),
    healthCheckIntervalMs: parseInt(process.env.DECODO_HEALTH_CHECK_INTERVAL || '300000'),
    healthCheckTimeoutMs: parseInt(process.env.DECODO_HEALTH_CHECK_TIMEOUT || '10000'),
    enableLogging: process.env.DECODO_ENABLE_LOGGING !== 'false',
  },
  messageQueue: {
    enabled: process.env.MESSAGE_QUEUE_ENABLED !== 'false',
    maxQueueSize: parseInt(process.env.MESSAGE_QUEUE_MAX_SIZE || '1000'),
    messagesPerMinute: parseInt(process.env.MESSAGE_QUEUE_RATE_LIMIT || '20'),
    messageDelayMs: parseInt(process.env.MESSAGE_QUEUE_DELAY || '3000'),
    maxRetryAttempts: parseInt(process.env.MESSAGE_QUEUE_MAX_RETRIES || '3'),
    retryDelayMultiplier: parseFloat(process.env.MESSAGE_QUEUE_RETRY_MULTIPLIER || '2'),
    maxRetryDelayMs: parseInt(process.env.MESSAGE_QUEUE_MAX_RETRY_DELAY || '60000'),
    processingIntervalMs: parseInt(process.env.MESSAGE_QUEUE_PROCESSING_INTERVAL || '1000'),
    enableLogging: process.env.MESSAGE_QUEUE_ENABLE_LOGGING !== 'false',
  },
  countryMapping: {
    // Israel/Palestine region mapping
    'IL': 'IL', // Israel
    'PS': 'IL', // Palestine -> use Israeli proxies
    'JO': 'IL', // Jordan -> use Israeli proxies (regional)
    'LB': 'IL', // Lebanon -> use Israeli proxies (regional)
    'SY': 'IL', // Syria -> use Israeli proxies (regional)
    
    // Other countries
    'US': 'US', // United States
    'GB': 'GB', // United Kingdom
    'DE': 'DE', // Germany
    'FR': 'FR', // France
    'CA': 'CA', // Canada
    'AU': 'AU', // Australia
    'JP': 'JP', // Japan
    'IN': 'IN', // India
    'BR': 'BR', // Brazil
    'MX': 'MX', // Mexico
    'IT': 'IT', // Italy
    'ES': 'ES', // Spain
    'NL': 'NL', // Netherlands
    'SE': 'SE', // Sweden
    'NO': 'NO', // Norway
    'DK': 'DK', // Denmark
    'FI': 'FI', // Finland
    'PL': 'PL', // Poland
    'CZ': 'CZ', // Czech Republic
    'HU': 'HU', // Hungary
    'RO': 'RO', // Romania
    'BG': 'BG', // Bulgaria
    'GR': 'GR', // Greece
    'TR': 'TR', // Turkey
    'RU': 'RU', // Russia
    'UA': 'UA', // Ukraine
    'BY': 'BY', // Belarus
    'LT': 'LT', // Lithuania
    'LV': 'LV', // Latvia
    'EE': 'EE', // Estonia
    'CN': 'CN', // China
    'KR': 'KR', // South Korea
    'TH': 'TH', // Thailand
    'VN': 'VN', // Vietnam
    'MY': 'MY', // Malaysia
    'SG': 'SG', // Singapore
    'ID': 'ID', // Indonesia
    'PH': 'PH', // Philippines
    'TW': 'TW', // Taiwan
    'HK': 'HK', // Hong Kong
    'ZA': 'ZA', // South Africa
    'EG': 'EG', // Egypt
    'NG': 'NG', // Nigeria
    'KE': 'KE', // Kenya
    'MA': 'MA', // Morocco
    'TN': 'TN', // Tunisia
    'DZ': 'DZ', // Algeria
    'SA': 'SA', // Saudi Arabia
    'AE': 'AE', // UAE
    'QA': 'QA', // Qatar
    'KW': 'KW', // Kuwait
    'BH': 'BH', // Bahrain
    'OM': 'OM', // Oman
    'IQ': 'IQ', // Iraq
    'IR': 'IR', // Iran
    'AF': 'AF', // Afghanistan
    'PK': 'PK', // Pakistan
    'BD': 'BD', // Bangladesh
    'LK': 'LK', // Sri Lanka
    'NP': 'NP', // Nepal
    'MM': 'MM', // Myanmar
    'KH': 'KH', // Cambodia
    'LA': 'LA', // Laos
    'MN': 'MN', // Mongolia
    'KZ': 'KZ', // Kazakhstan
    'UZ': 'UZ', // Uzbekistan
    'KG': 'KG', // Kyrgyzstan
    'TJ': 'TJ', // Tajikistan
    'TM': 'TM', // Turkmenistan
    'AZ': 'AZ', // Azerbaijan
    'AM': 'AM', // Armenia
    'GE': 'GE', // Georgia
    'MD': 'MD', // Moldova
    'RS': 'RS', // Serbia
    'HR': 'HR', // Croatia
    'BA': 'BA', // Bosnia and Herzegovina
    'ME': 'ME', // Montenegro
    'MK': 'MK', // North Macedonia
    'AL': 'AL', // Albania
    'XK': 'XK', // Kosovo
    'SI': 'SI', // Slovenia
    'SK': 'SK', // Slovakia
    'AT': 'AT', // Austria
    'CH': 'CH', // Switzerland
    'BE': 'BE', // Belgium
    'LU': 'LU', // Luxembourg
    'IE': 'IE', // Ireland
    'PT': 'PT', // Portugal
    'MT': 'MT', // Malta
    'CY': 'CY', // Cyprus
    'IS': 'IS', // Iceland
    'FO': 'FO', // Faroe Islands
    'GL': 'GL', // Greenland
    'AD': 'AD', // Andorra
    'MC': 'MC', // Monaco
    'SM': 'SM', // San Marino
    'VA': 'VA', // Vatican City
    'LI': 'LI', // Liechtenstein
    
    // Default fallback
    'DEFAULT': 'US',
  },
  rateLimiting: {
    enabled: process.env.RATE_LIMITING_ENABLED !== 'false',
    windowMs: parseInt(process.env.RATE_LIMITING_WINDOW || '60000'), // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMITING_MAX_REQUESTS || '30'),
    skipSuccessfulRequests: process.env.RATE_LIMITING_SKIP_SUCCESS === 'true',
    skipFailedRequests: process.env.RATE_LIMITING_SKIP_FAILED === 'true',
  },
  monitoring: {
    enabled: process.env.MONITORING_ENABLED !== 'false',
    metricsIntervalMs: parseInt(process.env.MONITORING_METRICS_INTERVAL || '60000'), // 1 minute
    healthCheckIntervalMs: parseInt(process.env.MONITORING_HEALTH_CHECK_INTERVAL || '300000'), // 5 minutes
    alertThresholds: {
      errorRate: parseFloat(process.env.MONITORING_ERROR_RATE_THRESHOLD || '0.1'), // 10%
      responseTime: parseInt(process.env.MONITORING_RESPONSE_TIME_THRESHOLD || '5000'), // 5 seconds
      queueSize: parseInt(process.env.MONITORING_QUEUE_SIZE_THRESHOLD || '100'),
    },
  },
};

/**
 * Validate configuration
 */
function validateConfig(config: ProxyConfig): void {
  const errors: string[] = [];

  // Validate Decodo configuration
  if (config.decodo.enabled) {
    if (!config.decodo.username) {
      errors.push('DECODO_USERNAME is required when Decodo is enabled');
    }
    if (!config.decodo.password) {
      errors.push('DECODO_PASSWORD is required when Decodo is enabled');
    }
    if (!config.decodo.endpoint) {
      errors.push('DECODO_ENDPOINT is required when Decodo is enabled');
    }
    if (config.decodo.port < 1 || config.decodo.port > 65535) {
      errors.push('DECODO_PORT must be between 1 and 65535');
    }
  }

  // Validate message queue configuration
  if (config.messageQueue.enabled) {
    if (config.messageQueue.maxQueueSize < 1) {
      errors.push('MESSAGE_QUEUE_MAX_SIZE must be greater than 0');
    }
    if (config.messageQueue.messagesPerMinute < 1) {
      errors.push('MESSAGE_QUEUE_RATE_LIMIT must be greater than 0');
    }
    if (config.messageQueue.messageDelayMs < 0) {
      errors.push('MESSAGE_QUEUE_DELAY must be non-negative');
    }
  }

  // Validate rate limiting configuration
  if (config.rateLimiting.enabled) {
    if (config.rateLimiting.windowMs < 1000) {
      errors.push('RATE_LIMITING_WINDOW must be at least 1000ms');
    }
    if (config.rateLimiting.maxRequests < 1) {
      errors.push('RATE_LIMITING_MAX_REQUESTS must be greater than 0');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Get proxy configuration
 */
export function getProxyConfig(): ProxyConfig {
  validateConfig(defaultConfig);
  return defaultConfig;
}

/**
 * Get country mapping for proxy selection
 */
export function getCountryMapping(): Record<string, string> {
  return defaultConfig.countryMapping;
}

/**
 * Get proxy country for device country
 */
export function getProxyCountry(deviceCountry: string): string {
  const mapping = getCountryMapping();
  return mapping[deviceCountry.toUpperCase()] || mapping['DEFAULT'];
}

/**
 * Check if Decodo is enabled
 */
export function isDecodoEnabled(): boolean {
  return defaultConfig.decodo.enabled;
}

/**
 * Check if message queue is enabled
 */
export function isMessageQueueEnabled(): boolean {
  return defaultConfig.messageQueue.enabled;
}

/**
 * Check if monitoring is enabled
 */
export function isMonitoringEnabled(): boolean {
  return defaultConfig.monitoring.enabled;
}

export default defaultConfig;
