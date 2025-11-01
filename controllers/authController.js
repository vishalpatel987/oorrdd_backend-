const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const sendEmail = require('../utils/sendEmail');
const crypto = require('crypto');
const { asyncHandler } = require('../middleware/errorMiddleware');

// @desc    Register user (legacy immediate signup)
// @route   POST /api/auth/register
// @access  Public
const register = asyncHandler(async (req, res) => {
  const { name, email, password, role = 'customer' } = req.body;

  const normalizedEmail = normalizeEmail(email);
  if (!name || !normalizedEmail || !password) {
    return res.status(400).json({ message: 'Name, email and password are required' });
  }

  // Check if user exists
  const userExists = await User.findOne({ email: normalizedEmail });
  if (userExists) {
    return res.status(400).json({ message: 'User already exists' });
  }

  // Create user
  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    role
  });

  if (user) {
    res.status(201).json({
      token: generateToken(user._id),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } else {
    res.status(400).json({ message: 'Invalid user data' });
  }
});

// -------- Registration with Email OTP verification --------
// @desc    Start registration: create account (unverified) and email OTP
// @route   POST /api/auth/register/start
// @access  Public
const startRegistrationWithOTP = asyncHandler(async (req, res) => {
  const { name, email, password, role = 'customer' } = req.body;
  const normalizedEmail = normalizeEmail(email);
  if (!name || !normalizedEmail || !password) {
    return res.status(400).json({ message: 'Name, email and password are required' });
  }

  let user = await User.findOne({ email: normalizedEmail }).select('+password');
  if (user && user.isEmailVerified) {
    return res.status(400).json({ message: 'User already exists' });
  }

  // Create or update an unverified user record
  if (!user) {
    user = await User.create({ name, email: normalizedEmail, password, role, isEmailVerified: false });
  } else {
    // keep latest provided details and reset password if provided
    user.name = name;
    user.password = password;
    user.role = role;
    user.isEmailVerified = false;
  }

  const otp = generateSixDigitOTP();
  const hashed = hashValueSha256(otp);
  user.emailVerificationOTP = hashed;
  user.emailVerificationOTPExpire = new Date(Date.now() + 10 * 60 * 1000);
  user.emailVerificationOTPAttempts = 0;
  await user.save();

  const subject = 'Verify your email - MV Store';
  const html = `<p>Hi ${name || ''},</p>
    <p>Your verification code is:</p>
    <h2 style="letter-spacing:4px">${otp}</h2>
    <p>This code will expire in 10 minutes.</p>`;

  try {
    await sendEmail({ email: normalizedEmail, subject, message: `Your OTP is ${otp}`, html });
    return res.status(200).json({ message: 'OTP sent to email', email: normalizedEmail });
  } catch (err) {
    user.emailVerificationOTP = undefined;
    user.emailVerificationOTPExpire = undefined;
    user.emailVerificationOTPAttempts = 0;
    await user.save();
    return res.status(500).json({ message: 'Failed to send OTP email' });
  }
});

// @desc    Verify registration OTP and finalize account
// @route   POST /api/auth/register/verify
// @access  Public
const verifyRegistrationOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !otp) {
    return res.status(400).json({ message: 'Email and OTP are required' });
  }

  const user = await User.findOne({ email: normalizedEmail }).select('+password');
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (user.isEmailVerified) {
    return res.status(200).json({
      token: generateToken(user._id),
      user: { _id: user._id, name: user.name, email: user.email, role: user.role }
    });
  }

  if (!user.emailVerificationOTP || !user.emailVerificationOTPExpire) {
    return res.status(400).json({ message: 'No OTP requested' });
  }
  if ((user.emailVerificationOTPAttempts || 0) >= 5) {
    return res.status(429).json({ message: 'Too many attempts. Please request a new OTP.' });
  }
  if (Date.now() > new Date(user.emailVerificationOTPExpire).getTime()) {
    return res.status(400).json({ message: 'OTP expired' });
  }
  const hashed = hashValueSha256(otp);
  if (hashed !== user.emailVerificationOTP) {
    user.emailVerificationOTPAttempts = (user.emailVerificationOTPAttempts || 0) + 1;
    await user.save();
    return res.status(400).json({ message: 'Invalid OTP' });
  }

  user.isEmailVerified = true;
  user.emailVerificationOTP = undefined;
  user.emailVerificationOTPExpire = undefined;
  user.emailVerificationOTPAttempts = 0;
  await user.save();

  return res.status(200).json({
    token: generateToken(user._id),
    user: { _id: user._id, name: user.name, email: user.email, role: user.role }
  });
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res) => {
  const { email, password, role } = req.body;

  // Check for user email
  const user = await User.findOne({ email }).select('+password');

  // If user is a seller, check approval
  if (user && user.role === 'seller') {
    const seller = await require('../models/Seller').findOne({ userId: user._id });
    if (!seller || !seller.isApproved) {
      return res.status(403).json({ message: 'Your seller account is not approved yet. Please wait for admin approval.' });
    }
  }

  if (user && (await user.matchPassword(password))) {
    if (!user.isEmailVerified) {
      // Allow legacy accounts (created before OTP enforcement) to log in without email verification
      const enforceFrom = process.env.OTP_ENFORCE_FROM || '2025-10-30T00:00:00.000Z';
      const isLegacy = user.createdAt && new Date(user.createdAt).getTime() < new Date(enforceFrom).getTime();

      if (isLegacy) {
        // Mark verified once to avoid future prompts
        user.isEmailVerified = true;
        try { await user.save(); } catch (e) {}
      } else {
        return res.status(403).json({ message: 'Please verify your email to continue. Check your inbox for the OTP.' });
      }
    }
    res.json({
      token: generateToken(user._id),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } else {
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({
    success: true,
    data: user
  });
});

// (Legacy token-based forgot password removed; using OTP-only flow.)

// -------- OTP-based password reset flow --------

// Helpers
const generateSixDigitOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
const hashValueSha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

// @desc    Request OTP for password reset
// @route   POST /api/auth/forgot-password-otp
// @access  Public
const requestPasswordResetOTP = asyncHandler(async (req, res) => {
  const { email: rawEmail } = req.body;
  const email = normalizeEmail(rawEmail);
  if (!email) return res.status(400).json({ message: 'Email is required' });

  // Always act on the latest record for this email (handles legacy duplicates)
  const candidates = await User.find({ email }).sort({ updatedAt: -1 }).limit(1);
  const user = candidates[0];
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  const otp = generateSixDigitOTP();
  const hashed = hashValueSha256(otp);
  const expireAt = new Date(Date.now() + 10 * 60 * 1000);
  // Update all duplicate records for this email to avoid mismatch issues
  await User.updateMany(
    { email },
    {
      $set: {
        resetPasswordOTP: hashed,
        resetPasswordOTPExpire: expireAt,
        resetPasswordOTPVerified: false,
        resetPasswordOTPAttempts: 0
      }
    }
  );

  const subject = 'Your OTP for Password Reset';
  const html = `<p>Hi ${user.name || ''},</p>
    <p>Your OTP for password reset is:</p>
    <h2 style="letter-spacing:4px">${otp}</h2>
    <p>This OTP will expire in 10 minutes. If you did not request this, please ignore this email.</p>`;

  try {
    await sendEmail({ email: user.email, subject, message: `Your OTP is ${otp}`, html });
    return res.json({ message: 'OTP sent to email' });
  } catch (err) {
    // Clean up OTP fields on failure to send
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpire = undefined;
    user.resetPasswordOTPVerified = false;
    user.resetPasswordOTPAttempts = 0;
    await user.save();
    return res.status(500).json({ message: 'Failed to send OTP email' });
  }
});

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyPasswordResetOTP = asyncHandler(async (req, res) => {
  const { email: rawEmail, otp } = req.body;
  const email = normalizeEmail(rawEmail);
  if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

  // Try to find an active OTP for this email
  const hashed = hashValueSha256(otp);
  let user = await User.findOne({
    email,
    resetPasswordOTP: { $exists: true, $ne: null },
    resetPasswordOTPExpire: { $gt: Date.now() }
  }).sort({ resetPasswordOTPExpire: -1, updatedAt: -1 });

  // If not found by active window, try exact hash match across recent records
  if (!user) {
    user = await User.findOne({ email, resetPasswordOTP: hashed }).sort({ updatedAt: -1 });
  }

  if (!user || !user.resetPasswordOTP || !user.resetPasswordOTPExpire) {
    return res.status(400).json({ message: 'No OTP requested' });
  }

  if ((user.resetPasswordOTPAttempts || 0) >= 5) {
    return res.status(429).json({ message: 'Too many attempts. Please request a new OTP.' });
  }

  if (Date.now() > new Date(user.resetPasswordOTPExpire).getTime()) {
    return res.status(400).json({ message: 'OTP expired' });
  }
  if (hashed !== user.resetPasswordOTP) {
    user.resetPasswordOTPAttempts = (user.resetPasswordOTPAttempts || 0) + 1;
    await user.save();
    return res.status(400).json({ message: 'Invalid OTP' });
  }

  user.resetPasswordOTPVerified = true;
  await user.save();
  return res.json({ message: 'OTP verified successfully' });
});

// @desc    Reset password using OTP
// @route   PUT /api/auth/reset-password-otp
// @access  Public
const resetPasswordWithOTP = asyncHandler(async (req, res) => {
  const { email: rawEmail, otp, password, confirmPassword } = req.body;
  const email = normalizeEmail(rawEmail);
  if (!email || !password || !confirmPassword) {
    return res.status(400).json({ message: 'Email, password and confirmPassword are required' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }
  // Build a query to select the record that either has a verified OTP in window
  // or matches the provided OTP within the active window.
  const now = Date.now();
  const latestUser = await User.find({ email }).sort({ resetPasswordOTPExpire: -1, updatedAt: -1 }).limit(1).select('+password');
  const user = latestUser[0];
  if (!user) return res.status(404).json({ message: 'User not found' });

  const hasValidWindow = user.resetPasswordOTPExpire && now <= new Date(user.resetPasswordOTPExpire).getTime();
  let otpValid = false;
  if (otp) {
    const hashed = hashValueSha256(otp);
    otpValid = user.resetPasswordOTP && hashed === user.resetPasswordOTP && hasValidWindow;
  }

  if (!(otpValid || (user.resetPasswordOTPVerified && hasValidWindow))) {
    return res.status(400).json({ message: 'OTP not verified or expired' });
  }

  user.password = password;
  // Clear OTP related fields
  user.resetPasswordOTP = undefined;
  user.resetPasswordOTPExpire = undefined;
  user.resetPasswordOTPVerified = false;
  user.resetPasswordOTPAttempts = 0;
  // Also clear any old token-based fields
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  return res.json({ message: 'Password changed successfully' });
});

// @desc    Verify email
// @route   GET /api/auth/verify-email/:token
// @access  Public
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.params;
  
  // For now, just return success (email verification can be implemented later)
  res.json({ message: 'Email verified successfully' });
});

// -------- Legacy link-based forgot password (re-enabled) --------
// @desc    Send password reset link to email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email: rawEmail } = req.body;
  const email = normalizeEmail(rawEmail);
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ message: 'User not found' });

  const resetToken = user.getResetPasswordToken();
  await user.save({ validateBeforeSave: false });

  const clientBase = process.env.CLIENT_URL || req.get('origin') || 'http://localhost:3000';
  const resetUrl = `${clientBase}/reset-password/${resetToken}`;
  const subject = 'Reset your password - MV Store';
  const html = `<p>Hi ${user.name || ''},</p>
    <p>You requested to reset your password. Click the link below:</p>
    <p><a href="${resetUrl}">Reset Password</a></p>
    <p>This link will expire in 10 minutes. If you did not request this, please ignore this email.</p>`;

  try {
    await sendEmail({ email: user.email, subject, message: `Reset your password: ${resetUrl}`, html });
    return res.json({ message: 'Password reset link sent to your email' });
  } catch (err) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });
    return res.status(500).json({ message: 'Email could not be sent' });
  }
});

// @desc    Reset password using link token
// @route   PUT /api/auth/reset-password/:token
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  if (!password) return res.status(400).json({ message: 'Password is required' });

  const resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken,
    resetPasswordExpire: { $gt: Date.now() }
  }).select('+password');

  if (!user) return res.status(400).json({ message: 'Invalid or expired token' });

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  return res.json({ message: 'Password reset successful' });
});

module.exports = {
  register,
  startRegistrationWithOTP,
  verifyRegistrationOTP,
  login,
  getMe,
  verifyEmail,
  requestPasswordResetOTP,
  verifyPasswordResetOTP,
  resetPasswordWithOTP,
  // newly re-enabled link flow
  forgotPassword,
  resetPassword
}; 