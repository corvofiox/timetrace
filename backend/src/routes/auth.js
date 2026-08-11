const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getMe,
  updateAvatar,
  refreshToken,
  logout
} = require('../controllers/auth');
const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/logout', protect, logout);
router.post('/avatar', protect, updateAvatar);
router.get('/me', protect, getMe);

module.exports = router;