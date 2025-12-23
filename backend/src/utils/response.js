function successResponse(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    ...data
  });
}

function errorResponse(res, message, statusCode = 400) {
  return res.status(statusCode).json({
    success: false,
    message
  });
}

function validationErrorResponse(res, message) {
  return errorResponse(res, message, 400);
}

function unauthorizedResponse(res, message = 'Unauthorized') {
  return errorResponse(res, message, 401);
}

function notFoundResponse(res, message = 'Resource not found') {
  return errorResponse(res, message, 404);
}

function createdResponse(res, data) {
  return successResponse(res, data, 201);
}

module.exports = {
  successResponse,
  errorResponse,
  validationErrorResponse,
  unauthorizedResponse,
  notFoundResponse,
  createdResponse
};
