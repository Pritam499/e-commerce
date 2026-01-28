import { safeLog, safeErrorLog, maskObject } from "./data-masking";
import * as fs from 'fs';
import * as path from 'path';

export class SecureLogger {
  private static instance: SecureLogger;
  private logLevel: 'error' | 'warn' | 'info' | 'debug' = 'info';
  private lokiStream: fs.WriteStream | null = null;
  private securityStream: fs.WriteStream | null = null;

  private constructor() {
    // Set log level from environment
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    if (envLevel === 'error' || envLevel === 'warn' || envLevel === 'info' || envLevel === 'debug') {
      this.logLevel = envLevel;
    }

    // Initialize log streams for Loki
    this.initializeLogStreams();
  }

  private initializeLogStreams(): void {
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // Loki-compatible JSON logs
      this.lokiStream = fs.createWriteStream(path.join(logsDir, 'loki.log'), {
        flags: 'a',
        encoding: 'utf8'
      });

      // Security logs
      this.securityStream = fs.createWriteStream(path.join(logsDir, 'security.log'), {
        flags: 'a',
        encoding: 'utf8'
      });
    } catch (error) {
      console.error('Failed to initialize log streams:', error);
    }
  }

  static getInstance(): SecureLogger {
    if (!SecureLogger.instance) {
      SecureLogger.instance = new SecureLogger();
    }
    return SecureLogger.instance;
  }

  private shouldLog(level: string): boolean {
    const levels = ['error', 'warn', 'info', 'debug'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  private writeStructuredLog(level: string, message: string, data?: any): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: 'ecommerce-api',
      hostname: require('os').hostname(),
      pid: process.pid,
      environment: process.env.NODE_ENV || 'development',
      ...maskObject(data || {}),
    };

    const jsonLog = JSON.stringify(logEntry) + '\n';

    // Write to Loki stream
    if (this.lokiStream) {
      this.lokiStream.write(jsonLog);
    }

    // Also write to console with color coding
    const colorCode = {
      error: '\x1b[31m', // Red
      warn: '\x1b[33m',  // Yellow
      info: '\x1b[36m',  // Cyan
      debug: '\x1b[35m', // Magenta
    }[level] || '\x1b[37m'; // White

    const resetCode = '\x1b[0m';
    console.log(`${colorCode}[${level.toUpperCase()}]${resetCode} ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  error(message: string, data?: any): void {
    if (this.shouldLog('error')) {
      this.writeStructuredLog('error', message, data);
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog('warn')) {
      this.writeStructuredLog('warn', message, data);
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog('info')) {
      this.writeStructuredLog('info', message, data);
    }
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog('debug')) {
      this.writeStructuredLog('debug', message, data);
    }
  }

  // Specialized logging methods
  auth(message: string, userId?: string, data?: any): void {
    const maskedData = {
      userId: userId ? maskObject({ userId }).userId : undefined,
      ...maskObject(data || {}),
    };
    this.info(`AUTH: ${message}`, maskedData);
  }

  database(operation: string, table: string, data?: any): void {
    const maskedData = data ? maskObject(data) : undefined;
    this.debug(`DB: ${operation} on ${table}`, maskedData);
  }

  api(method: string, path: string, statusCode: number, userId?: string, data?: any): void {
    const maskedData = {
      method,
      path,
      statusCode,
      userId: userId ? maskObject({ userId }).userId : undefined,
      ...maskObject(data || {}),
    };
    this.info(`API: ${method} ${path} -> ${statusCode}`, maskedData);
  }

  security(event: string, userId?: string, ip?: string, data?: any): void {
    const maskedData = {
      event,
      userId: userId ? maskObject({ userId }).userId : undefined,
      ip: ip ? maskObject({ ip }).ip : undefined,
      timestamp: new Date().toISOString(),
      ...maskObject(data || {}),
    };

    // Write to security log stream
    if (this.securityStream) {
      const logEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'security',
        event,
        userId: maskedData.userId,
        ip: maskedData.ip,
        service: 'ecommerce-api',
        hostname: require('os').hostname(),
        ...maskedData,
      }) + '\n';
      this.securityStream.write(logEntry);
    }

    this.warn(`SECURITY: ${event}`, maskedData);
  }

  errorWithContext(error: Error, context: string, userId?: string, data?: any): void {
    safeErrorLog(error, context, {
      userId: userId ? maskObject({ userId }).userId : undefined,
      ...maskObject(data || {}),
    });
  }

  // GDPR compliance logging
  gdpr(event: 'access' | 'rectification' | 'erasure' | 'portability' | 'restriction' | 'objection',
       userId: string,
       data?: any): void {
    const maskedData = {
      gdprEvent: event,
      userId: maskObject({ userId }).userId,
      timestamp: new Date().toISOString(),
      ...maskObject(data || {}),
    };
    this.info(`GDPR: ${event.toUpperCase()} request for user`, maskedData);
  }

  // Performance logging
  performance(operation: string, duration: number, data?: any): void {
    const maskedData = {
      operation,
      duration,
      ...maskObject(data || {}),
    };
    this.debug(`PERF: ${operation} took ${duration}ms`, maskedData);
  }
}

// Export singleton instance
export const logger = SecureLogger.getInstance();

// Override console methods to use secure logging
const originalConsole = { ...console };

console.log = (...args: any[]) => {
  logger.info(args.join(' '), args.length > 1 ? args.slice(1) : undefined);
};

console.info = (...args: any[]) => {
  logger.info(args.join(' '), args.length > 1 ? args.slice(1) : undefined);
};

console.warn = (...args: any[]) => {
  logger.warn(args.join(' '), args.length > 1 ? args.slice(1) : undefined);
};

console.error = (...args: any[]) => {
  logger.error(args.join(' '), args.length > 1 ? args.slice(1) : undefined);
};

console.debug = (...args: any[]) => {
  logger.debug(args.join(' '), args.length > 1 ? args.slice(1) : undefined);
};

// Export override function for testing
export function restoreConsole(): void {
  Object.assign(console, originalConsole);
}