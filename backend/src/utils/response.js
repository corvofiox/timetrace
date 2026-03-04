function successResponse(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    ...data
  });
}

function errorResponse(res, message, statusCode = 400, errorCode = null, details = null) {
  const response = {
    success: false,
    message
  };
  
  if (errorCode) {
    response.errorCode = errorCode;
  }
  
  if (details) {
    response.details = details;
  }
  
  return res.status(statusCode).json(response);
}

function validationErrorResponse(res, message, errorCode = 'VALIDATION_ERROR', details = null) {
  return errorResponse(res, message, 400, errorCode, details);
}

function unauthorizedResponse(res, message = 'Unauthorized', errorCode = 'AUTH_ERROR', details = null) {
  return errorResponse(res, message, 401, errorCode, details);
}

function notFoundResponse(res, message = 'Resource not found', errorCode = 'NOT_FOUND', details = null) {
  return errorResponse(res, message, 404, errorCode, details);
}

function createdResponse(res, data) {
  return successResponse(res, data, 201);
}

function conflictResponse(res, message, errorCode = 'CONFLICT', details = null) {
  return errorResponse(res, message, 409, errorCode, details);
}

function serverErrorResponse(res, message = '服务器内部错误', errorCode = 'SERVER_ERROR', details = null) {
  return errorResponse(res, message, 500, errorCode, details);
}

function appErrorResponse(res, error) {
  if (error.isOperational) {
    return errorResponse(res, error.message, error.statusCode, error.errorCode, error.details);
  }
  
  console.error('非预期错误:', error);
  return serverErrorResponse(res, '服务器内部错误', 'UNKNOWN_ERROR');
}

module.exports = {
  successResponse,
  errorResponse,
  validationErrorResponse,
  unauthorizedResponse,
  notFoundResponse,
  createdResponse,
  conflictResponse,
  serverErrorResponse,
  appErrorResponse
};
