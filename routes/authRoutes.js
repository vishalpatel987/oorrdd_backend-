const express = require('express');
const router = express.Router();
const { register, login, getMe, verifyEmail, requestPasswordResetOTP, verifyPasswordResetOTP, resetPasswordWithOTP } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Public routes
router.post('/register', register);
router.post('/login', login);
router.get('/verify-email/:token', verifyEmail);
// OTP-based password reset routes
router.post('/forgot-password-otp', requestPasswordResetOTP);
router.post('/verify-otp', verifyPasswordResetOTP);
router.put('/reset-password-otp', resetPasswordWithOTP);

// Protected routes
router.get('/me', protect, getMe);

module.exports = router; 