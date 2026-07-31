const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getJWTSecret, getRefreshTokenSecret, getRefreshTokenExpireDays } = require('../config/keys');
const { 
  validationErrorResponse, 
  unauthorizedResponse, 
  notFoundResponse, 
  createdResponse, 
  successResponse, 
  conflictResponse,
  serverErrorResponse
} = require('../utils/response');
const { ErrorCodes } = require('../utils/errors');

function createJWTToken(payload, expiresIn) {
  return jwt.sign(payload, getJWTSecret(), { expiresIn });
}

function createRefreshToken(payload, expiresIn) {
  return jwt.sign(payload, getRefreshTokenSecret(), { expiresIn });
}

const { 
  findUserByEmail, 
  findUserById, 
  getAllUsers,
  createUser,
  saveRefreshToken,
  findRefreshToken,
  deleteRefreshToken,
  rotateRefreshToken
} = require('../models/database');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_PASSWORD_LENGTH = 128;

exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || username.trim() === '') {
      return validationErrorResponse(res, '用户名不能为空', ErrorCodes.VALIDATION_REQUIRED, {
        field: 'username',
        reason: 'required'
      });
    }

    if (username.length < 2) {
      return validationErrorResponse(res, '用户名至少需要2个字符', ErrorCodes.VALIDATION_LENGTH, {
        field: 'username',
        reason: 'min_length',
        minLength: 2
      });
    }

    if (username.length > 50) {
      return validationErrorResponse(res, '用户名不能超过50个字符', ErrorCodes.VALIDATION_LENGTH, {
        field: 'username',
        reason: 'max_length',
        maxLength: 50
      });
    }

    if (!email || email.trim() === '') {
      return validationErrorResponse(res, '邮箱不能为空', ErrorCodes.VALIDATION_REQUIRED, {
        field: 'email',
        reason: 'required'
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      return validationErrorResponse(res, '请输入有效的邮箱地址', ErrorCodes.REG_EMAIL_INVALID, {
        field: 'email',
        reason: 'invalid_format'
      });
    }

    if (!password || password.trim() === '') {
      return validationErrorResponse(res, '密码不能为空', ErrorCodes.VALIDATION_REQUIRED, {
        field: 'password',
        reason: 'required'
      });
    }

    if (password.length < 6) {
      return validationErrorResponse(res, '密码长度至少为6个字符', ErrorCodes.REG_PASSWORD_TOO_SHORT, {
        field: 'password',
        reason: 'min_length',
        minLength: 6,
        actualLength: password.length
      });
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      return validationErrorResponse(res, `密码长度不能超过${MAX_PASSWORD_LENGTH}个字符`, ErrorCodes.VALIDATION_LENGTH, {
        field: 'password',
        reason: 'max_length',
        maxLength: MAX_PASSWORD_LENGTH,
        actualLength: password.length
      });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return conflictResponse(res, '该邮箱已被注册', ErrorCodes.REG_EMAIL_EXISTS, {
        field: 'email',
        reason: 'already_exists'
      });
    }

    // Check for duplicate username
    const allUsers = await getAllUsers();
    const normalizedUsername = username.trim().toLowerCase();
    const usernameExists = allUsers.find(u => u.username.toLowerCase() === normalizedUsername);
    if (usernameExists) {
      return conflictResponse(res, '该用户名已被使用', ErrorCodes.REG_USERNAME_EXISTS, {
        field: 'username',
        reason: 'already_exists'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await createUser({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword
    });

    const token = createJWTToken(
      { id: user.id },
      process.env.JWT_EXPIRE || '15m'
    );
    
    const refreshToken = createRefreshToken(
      { id: user.id },
      process.env.REFRESH_TOKEN_EXPIRE || '7d'
    );
    
    await saveRefreshToken(refreshToken, user.id);

    createdResponse(res, {
      token,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('[注册失败]', {
      error: error.message,
      stack: error.stack,
      body: { ...req.body, password: '[REDACTED]' }
    });
    
    if (error.message && error.message.includes('already exists')) {
      return conflictResponse(res, '用户名已被使用', ErrorCodes.REG_USERNAME_EXISTS, {
        field: 'username',
        reason: 'already_exists'
      });
    }
    
    return serverErrorResponse(res, '注册失败，请稍后重试');
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || email.trim() === '') {
      return validationErrorResponse(res, '请输入邮箱地址', ErrorCodes.VALIDATION_REQUIRED, {
        field: 'email',
        reason: 'required'
      });
    }

    if (!password || password.trim() === '') {
      return validationErrorResponse(res, '请输入密码', ErrorCodes.VALIDATION_REQUIRED, {
        field: 'password',
        reason: 'required'
      });
    }

    const user = await findUserByEmail(email.trim().toLowerCase());

    if (!user) {
      console.warn('[登录失败] 用户不存在', { email: email.trim().toLowerCase() });
      return unauthorizedResponse(res, '该邮箱未注册', ErrorCodes.LOGIN_USER_NOT_FOUND, {
        reason: 'user_not_found'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      console.warn('[登录失败] 密码错误', { email: email.trim().toLowerCase() });
      return unauthorizedResponse(res, '密码错误', ErrorCodes.LOGIN_WRONG_PASSWORD, {
        reason: 'wrong_password'
      });
    }

    const token = createJWTToken(
      { id: user.id },
      process.env.JWT_EXPIRE || '15m'
    );
    
    const refreshToken = createRefreshToken(
      { id: user.id },
      process.env.REFRESH_TOKEN_EXPIRE || '7d'
    );
    
    await saveRefreshToken(refreshToken, user.id);

    console.log('[登录成功]', { userId: user.id, email: user.email });

    successResponse(res, {
      token,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('[登录失败]', {
      error: error.message,
      stack: error.stack,
      email: req.body.email
    });
    
    return serverErrorResponse(res, '登录失败，请稍后重试');
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await findUserById(req.user.id);

    if (!user) {
      return notFoundResponse(res, '用户不存在', ErrorCodes.AUTH_USER_NOT_FOUND, {
        userId: req.user.id
      });
    }

    const { password, ...userWithoutPassword } = user;

    successResponse(res, { data: userWithoutPassword });
  } catch (error) {
    console.error('[获取用户信息失败]', {
      error: error.message,
      userId: req.user?.id
    });
    
    return serverErrorResponse(res, '获取用户信息失败');
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return unauthorizedResponse(res, '请提供刷新令牌', ErrorCodes.AUTH_TOKEN_MISSING, {
        reason: 'refresh_token_missing'
      });
    }

    const tokenData = await findRefreshToken(refreshToken, getRefreshTokenExpireDays());
    if (!tokenData) {
      return unauthorizedResponse(res, '无效的刷新令牌', ErrorCodes.AUTH_TOKEN_INVALID, {
        reason: 'refresh_token_invalid'
      });
    }

    const decoded = jwt.verify(refreshToken, getRefreshTokenSecret());

    // 校验令牌归属与数据库中记录一致，防止跨用户使用
    if (tokenData.userId !== decoded.id) {
      console.warn('[刷新令牌失败] 令牌与用户不匹配', {
        tokenUserId: tokenData.userId,
        decodedUserId: decoded.id
      });
      return unauthorizedResponse(res, '无效的刷新令牌', ErrorCodes.AUTH_TOKEN_INVALID, {
        reason: 'refresh_token_invalid'
      });
    }

    const user = await findUserById(decoded.id);
    if (!user) {
      return unauthorizedResponse(res, '用户不存在', ErrorCodes.AUTH_USER_NOT_FOUND, {
        reason: 'user_not_found'
      });
    }

    const newToken = createJWTToken(
      { id: user.id },
      process.env.JWT_EXPIRE || '15m'
    );

    // 原子化轮换刷新令牌：删除旧令牌并保存新令牌
    const newRefreshToken = createRefreshToken(
      { id: user.id },
      process.env.REFRESH_TOKEN_EXPIRE || '7d'
    );
    await rotateRefreshToken(refreshToken, newRefreshToken, user.id);

    successResponse(res, { token: newToken, refreshToken: newRefreshToken });
  } catch (error) {
    console.error('[刷新令牌失败]', {
      error: error.message,
      errorName: error.name
    });
    
    if (error.name === 'TokenExpiredError') {
      return unauthorizedResponse(res, '刷新令牌已过期，请重新登录', ErrorCodes.AUTH_TOKEN_EXPIRED, {
        reason: 'refresh_token_expired'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return unauthorizedResponse(res, '无效的刷新令牌', ErrorCodes.AUTH_TOKEN_INVALID, {
        reason: 'refresh_token_invalid'
      });
    }
    
    return serverErrorResponse(res, '刷新令牌失败');
  }
};

exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (refreshToken) {
      // 校验 refreshToken 是否属于当前用户
      const tokenData = await findRefreshToken(refreshToken);
      if (tokenData && tokenData.userId !== req.user.id) {
        return unauthorizedResponse(res, '无权操作该刷新令牌', ErrorCodes.AUTH_UNAUTHORIZED, {
          reason: 'token_not_owned'
        });
      }
      await deleteRefreshToken(refreshToken);
    }

    successResponse(res, { message: '已成功退出登录' });
  } catch (error) {
    console.error('[退出登录失败]', {
      error: error.message,
      userId: req.user?.id
    });
    
    return serverErrorResponse(res, '退出登录失败');
  }
};
