const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getJWTSecret, getRefreshTokenSecret } = require('../config/keys');
const { validationErrorResponse, unauthorizedResponse, notFoundResponse, createdResponse, successResponse, errorResponse } = require('../utils/response');

// 创建JWT令牌的辅助函数
function createJWTToken(payload, expiresIn) {
  return jwt.sign(payload, getJWTSecret(), { expiresIn });
}

// 创建刷新令牌的辅助函数
function createRefreshToken(payload, expiresIn) {
  return jwt.sign(payload, getRefreshTokenSecret(), { expiresIn });
}

const { 
  findUserByEmail, 
  findUserById, 
  createUser,
  saveRefreshToken,
  findRefreshToken,
  deleteRefreshToken
} = require('../models/database');

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!password || password.trim() === '') {
      return validationErrorResponse(res, 'Password is required');
    }

    if (password.length < 6) {
      return validationErrorResponse(res, 'Password must be at least 6 characters long');
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return validationErrorResponse(res, 'User with that email already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await createUser({
      username,
      email,
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
    errorResponse(res, error.message);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return validationErrorResponse(res, 'Please provide an email and password');
    }

    if (password.trim() === '') {
      return validationErrorResponse(res, 'Password is required');
    }

    const user = await findUserByEmail(email);

    if (!user) {
      return unauthorizedResponse(res, 'Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return unauthorizedResponse(res, 'Invalid credentials');
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
    errorResponse(res, error.message);
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await findUserById(req.user.id);

    if (!user) {
      return notFoundResponse(res, 'User not found');
    }

    const { password, ...userWithoutPassword } = user;

    successResponse(res, { data: userWithoutPassword });
  } catch (error) {
    errorResponse(res, error.message);
  }
};

// @desc    Refresh token
// @route   POST /api/auth/refresh
// @access  Public
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return unauthorizedResponse(res, 'No refresh token provided');
    }

    const tokenData = await findRefreshToken(refreshToken);
    if (!tokenData) {
      return unauthorizedResponse(res, 'Invalid refresh token');
    }

    const decoded = jwt.verify(refreshToken, getRefreshTokenSecret());

    const user = await findUserById(decoded.id);
    if (!user) {
      return unauthorizedResponse(res, 'User not found');
    }

    const newToken = createJWTToken(
      { id: user.id },
      process.env.JWT_EXPIRE || '15m'
    );

    successResponse(res, { token: newToken });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return unauthorizedResponse(res, 'Invalid or expired refresh token');
    }
    
    errorResponse(res, error.message);
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (refreshToken) {
      await deleteRefreshToken(refreshToken);
    }

    successResponse(res, { message: 'Logged out successfully' });
  } catch (error) {
    errorResponse(res, error.message);
  }
};