const express = require('express');
const router = express.Router();
const { register, startRegistrationWithOTP, verifyRegistrationOTP, login, getMe, verifyEmail, forgotPassword, resetPassword, requestPasswordResetOTP, verifyPasswordResetOTP, resetPasswordWithOTP } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Public routes
router.post('/register', register);
// Registration with email OTP
router.post('/register/start', startRegistrationWithOTP);
router.post('/register/verify', verifyRegistrationOTP);
router.post('/login', login);
router.get('/verify-email/:token', verifyEmail);
// Link-based password reset routes (OTP removed for forgot password)
router.post('/forgot-password', forgotPassword);
router.put('/reset-password/:token', resetPassword);

// OTP-based password reset routes (enabled per requirement)
router.post('/forgot-password-otp', requestPasswordResetOTP);
router.post('/verify-otp', verifyPasswordResetOTP);
router.put('/reset-password-otp', resetPasswordWithOTP);

// Protected routes
router.get('/me', protect, getMe);

module.exports = router; 