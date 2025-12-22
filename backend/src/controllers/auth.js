const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// 检查是否在Docker环境中
const isDocker = process.env.DOCKER_ENV === 'true' || fs.existsSync('/.dockerenv');

// 在Docker环境中，显式加载.env文件
if (isDocker) {
  const envPath = '/app/.env';
  if (fs.existsSync(envPath)) {
    console.log('Auth: 在Docker环境中显式加载.env文件:', envPath);
    require('dotenv').config({ path: envPath });
    
    // 验证关键环境变量
    if (!process.env.JWT_SECRET) {
      console.error('Auth: JWT_SECRET未加载成功');
    } else {
      console.log('Auth: JWT_SECRET已加载，长度:', process.env.JWT_SECRET.length);
    }
    
    if (!process.env.REFRESH_TOKEN_SECRET) {
      console.error('Auth: REFRESH_TOKEN_SECRET未加载成功');
    } else {
      console.log('Auth: REFRESH_TOKEN_SECRET已加载，长度:', process.env.REFRESH_TOKEN_SECRET.length);
    }
  } else {
    console.error('Auth: Docker环境中未找到.env文件:', envPath);
  }
}

const { 
  findUserByEmail, 
  findUserById, 
  createUser,
  saveRefreshToken,
  findRefreshToken,
  deleteRefreshToken,
  deleteAllUserRefreshTokens
} = require('../models/database');

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if user exists
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with that email already exists'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password || '', salt);

    // Create user
    const user = await createUser({
      username,
      email,
      password: hashedPassword
    });

    // Create token
    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );
    
    // Create refresh token
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRE }
    );
    
    // Save refresh token to database
    await saveRefreshToken(refreshToken, user.id);

    res.status(201).json({
      success: true,
      token,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email and password'
      });
    }

    // Check for user
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if password matches
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Create token
    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );
    
    // Create refresh token
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRE }
    );
    
    // Save refresh token to database
    await saveRefreshToken(refreshToken, user.id);

    res.status(200).json({
      success: true,
      token,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await findUserById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Return user without password
    const { password, ...userWithoutPassword } = user;

    res.status(200).json({
      success: true,
      data: userWithoutPassword
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Refresh token
// @route   POST /api/auth/refresh
// @access  Public
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'No refresh token provided'
      });
    }

    // Check if refresh token exists in database
    const tokenData = await findRefreshToken(refreshToken);
    if (!tokenData) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

    // Get user from the token
    const user = await findUserById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create new access token
    const newToken = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.status(200).json({
      success: true,
      token: newToken
    });
  } catch (error) {
    // If refresh token is expired or invalid
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    // If refresh token is provided, remove it from database
    if (refreshToken) {
      deleteRefreshToken(refreshToken);
    }
    
    // Alternatively, remove all refresh tokens for this user
    // deleteAllUserRefreshTokens(req.user.id);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};