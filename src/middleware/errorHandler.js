import winston from 'winston';

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'bca-api' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Error types
export const ErrorTypes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR'
};

// Custom error class
export class AppError extends Error {
  constructor(message, statusCode = 500, errorType = ErrorTypes.INTERNAL_ERROR, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Error handler middleware
export const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.timestamp = new Date().toISOString();
  error.path = req.path;
  error.method = req.method;
  error.ip = req.ip;
  error.userAgent = req.get('User-Agent');

  // Log error
  logger.error({
    message: err.message,
    stack: err.stack,
    statusCode: err.statusCode || 500,
    errorType: err.errorType || ErrorTypes.INTERNAL_ERROR,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    timestamp: error.timestamp
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = new AppError(message, 404, ErrorTypes.NOT_FOUND);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = new AppError(message, 400, ErrorTypes.CONFLICT);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new AppError(message, 400, ErrorTypes.VALIDATION_ERROR);
  }

  // Prisma errors
  if (err.code && err.code.startsWith('P')) {
    switch (err.code) {
      case 'P2002':
        error = new AppError('A record with this data already exists', 409, ErrorTypes.CONFLICT);
        break;
      case 'P2025':
        error = new AppError('Record not found', 404, ErrorTypes.NOT_FOUND);
        break;
      case 'P2003':
        error = new AppError('Foreign key constraint failed', 400, ErrorTypes.VALIDATION_ERROR);
        break;
      case 'P2024':
        error = new AppError('Database connection timeout', 503, ErrorTypes.DATABASE_ERROR);
        break;
      default:
        error = new AppError('Database operation failed', 500, ErrorTypes.DATABASE_ERROR);
    }
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token', 401, ErrorTypes.AUTHENTICATION_ERROR);
  }

  if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired', 401, ErrorTypes.AUTHENTICATION_ERROR);
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    const message = err.errors && err.errors.length > 0 
      ? err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      : 'Validation error';
    error = new AppError(message, 400, ErrorTypes.VALIDATION_ERROR);
  }

  // Rate limiting errors
  if (err.status === 429) {
    error = new AppError('Too many requests', 429, ErrorTypes.RATE_LIMIT_ERROR);
  }

  // Default to 500 server error
  if (!error.statusCode) {
    error = new AppError('Internal server error', 500, ErrorTypes.INTERNAL_ERROR);
  }

  // Send error response
  const response = {
    success: false,
    error: {
      message: error.message,
      type: error.errorType || ErrorTypes.INTERNAL_ERROR,
      timestamp: error.timestamp,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  };

  // Don't send stack trace in production
  if (process.env.NODE_ENV === 'production' && !error.isOperational) {
    response.error.message = 'Something went wrong!';
  }

  res.status(error.statusCode || 500).json(response);
};

// Async error handler wrapper
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// 404 handler
export const notFound = (req, res, next) => {
  const error = new AppError(`Not found - ${req.originalUrl}`, 404, ErrorTypes.NOT_FOUND);
  next(error);
};

// Export logger for use in other files
export { logger };
