const { serverErrorResponse } = require('../utils/response');
const { ErrorCodes } = require('../utils/errors');

function errorHandler(err, req, res, next) {
  // 生产环境不输出敏感信息到日志
  const isProduction = process.env.NODE_ENV === 'production';

  const logData = {
    error: err.message,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    timestamp: new Date().toISOString()
  };

  // 非生产环境才记录堆栈和请求详情
  if (!isProduction) {
    logData.stack = err.stack;
    logData.body = sanitizeBody(req.body);
    logData.query = req.query;
    logData.params = req.params;
  }

  console.error('[全局错误处理]', logData);

  if (err.isOperational) {
    return res.status(err.statusCode || 400).json({
      success: false,
      message: err.message,
      errorCode: err.errorCode || ErrorCodes.UNKNOWN_ERROR,
      details: err.details || null
    });
  }

  if (err.name === 'SyntaxError' && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: '请求体JSON格式错误',
      errorCode: 'SYNTAX_ERROR',
      details: {
        reason: 'invalid_json_body'
      }
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: err.message,
      errorCode: ErrorCodes.VALIDATION_REQUIRED,
      details: err.details || null
    });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: '文件大小超出限制',
      errorCode: 'FILE_TOO_LARGE',
      details: {
        reason: 'file_size_exceeded'
      }
    });
  }

  if (err.code === 'ENOENT') {
    return res.status(500).json({
      success: false,
      message: '服务器资源访问错误',
      errorCode: ErrorCodes.DB_READ_ERROR,
      details: {
        reason: 'file_not_found'
      }
    });
  }

  if (err.code === 'EACCES') {
    return res.status(500).json({
      success: false,
      message: '服务器权限错误',
      errorCode: ErrorCodes.DB_WRITE_ERROR,
      details: {
        reason: 'permission_denied'
      }
    });
  }

  console.error('[未处理的错误]', err);

  return serverErrorResponse(res, '服务器内部错误，请稍后重试');
}

function sanitizeBody(body) {
  if (!body) return body;
  
  const sanitized = { ...body };
  
  const sensitiveFields = ['password', 'confirmPassword', 'token', 'refreshToken', 'secret'];
  sensitiveFields.forEach(field => {
    if (sanitized[field] !== undefined) {
      sanitized[field] = '[REDACTED]';
    }
  });
  
  return sanitized;
}

function notFoundHandler(req, res, next) {
  console.warn('[路由不存在]', {
    path: req.path,
    method: req.method,
    userId: req.user?.id
  });
  
  res.status(404).json({
    success: false,
    message: `请求的资源不存在: ${req.method} ${req.path}`,
    errorCode: 'ROUTE_NOT_FOUND',
    details: {
      path: req.path,
      method: req.method
    }
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  sanitizeBody
};
