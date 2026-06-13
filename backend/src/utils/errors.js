class AppError extends Error {
  constructor(message, errorCode, statusCode = 400, details = null) {
    super(message);
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, errorCode = 'VALIDATION_ERROR', details = null) {
    super(message, errorCode, 400, details);
  }
}

class AuthenticationError extends AppError {
  constructor(message, errorCode = 'AUTH_ERROR', details = null) {
    super(message, errorCode, 401, details);
  }
}

class NotFoundError extends AppError {
  constructor(message, errorCode = 'NOT_FOUND', details = null) {
    super(message, errorCode, 404, details);
  }
}

class ConflictError extends AppError {
  constructor(message, errorCode = 'CONFLICT', details = null) {
    super(message, errorCode, 409, details);
  }
}

class DatabaseError extends AppError {
  constructor(message, errorCode = 'DATABASE_ERROR', details = null) {
    super(message, errorCode, 500, details);
  }
}

const ErrorCodes = {
  AUTH_TOKEN_MISSING: 'AUTH_001',
  AUTH_TOKEN_EXPIRED: 'AUTH_002',
  AUTH_TOKEN_INVALID: 'AUTH_003',
  AUTH_TOKEN_MALFORMED: 'AUTH_004',
  AUTH_USER_NOT_FOUND: 'AUTH_005',
  
  REG_EMAIL_EXISTS: 'REG_001',
  REG_USERNAME_EXISTS: 'REG_002',
  REG_PASSWORD_TOO_SHORT: 'REG_003',
  REG_EMAIL_INVALID: 'REG_004',
  
  LOGIN_USER_NOT_FOUND: 'LOGIN_001',
  LOGIN_WRONG_PASSWORD: 'LOGIN_002',
  LOGIN_ACCOUNT_DISABLED: 'LOGIN_003',
  
  GOAL_TITLE_EMPTY: 'GOAL_001',
  GOAL_TITLE_TOO_LONG: 'GOAL_002',
  GOAL_COLOR_INVALID: 'GOAL_003',
  GOAL_NOT_FOUND: 'GOAL_004',
  GOAL_NO_PERMISSION: 'GOAL_005',
  GOAL_DELETE_NO_PERMISSION: 'GOAL_006',
  
  DAY_DATE_INVALID: 'DAY_001',
  DAY_GOAL_NOT_FOUND: 'DAY_002',
  DAY_TIME_CONFLICT: 'DAY_003',
  DAY_TIME_INVALID: 'DAY_004',
  DAY_NOT_FOUND: 'DAY_005',
  
  VALIDATION_REQUIRED: 'VAL_001',
  VALIDATION_FORMAT: 'VAL_002',
  VALIDATION_LENGTH: 'VAL_003',
  VALIDATION_RANGE: 'VAL_004',
  
  DB_READ_ERROR: 'DB_001',
  DB_WRITE_ERROR: 'DB_002',
  DB_LOCK_ERROR: 'DB_003',
  
  UNKNOWN_ERROR: 'UNKNOWN_001'
};

module.exports = {
  ErrorCodes
};
