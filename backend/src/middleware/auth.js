const jwt = require('jsonwebtoken');
const { findUserById } = require('../models/database');
const { getJWTSecret } = require('../config/keys');
const { unauthorizedResponse } = require('../utils/response');
const { ErrorCodes } = require('../utils/errors');

exports.protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    console.error('[认证失败] 未提供认证令牌', {
      path: req.path,
      method: req.method,
      ip: req.ip
    });
    return unauthorizedResponse(res, '请提供认证令牌', ErrorCodes.AUTH_TOKEN_MISSING, {
      reason: 'token_missing'
    });
  }

  try {
    const decoded = jwt.verify(token, getJWTSecret());
    req.user = await findUserById(decoded.id);

    if (!req.user) {
      console.error('[认证失败] 用户不存在', {
        userId: decoded.id,
        path: req.path
      });
      return unauthorizedResponse(res, '用户不存在', ErrorCodes.AUTH_USER_NOT_FOUND, {
        reason: 'user_not_found',
        userId: decoded.id
      });
    }

    next();
  } catch (err) {
    console.error('[认证失败] 令牌验证错误', {
      errorName: err.name,
      errorMessage: err.message,
      path: req.path,
      method: req.method
    });

    if (err.name === 'TokenExpiredError') {
      return unauthorizedResponse(res, '登录已过期，请重新登录', ErrorCodes.AUTH_TOKEN_EXPIRED, {
        reason: 'token_expired',
        expiredAt: err.expiredAt
      });
    }

    if (err.name === 'JsonWebTokenError') {
      if (err.message === 'jwt malformed') {
        return unauthorizedResponse(res, '令牌格式错误', ErrorCodes.AUTH_TOKEN_MALFORMED, {
          reason: 'token_malformed'
        });
      }
      return unauthorizedResponse(res, '无效的令牌，请重新登录', ErrorCodes.AUTH_TOKEN_INVALID, {
        reason: 'token_invalid'
      });
    }

    if (err.name === 'NotBeforeError') {
      return unauthorizedResponse(res, '令牌尚未生效', ErrorCodes.AUTH_TOKEN_INVALID, {
        reason: 'token_not_active',
        date: err.date
      });
    }

    return unauthorizedResponse(res, '认证失败，请重新登录', ErrorCodes.AUTH_TOKEN_INVALID, {
      reason: 'unknown_auth_error'
    });
  }
};
