// src/routes/otp.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/otpAuthController');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

/**
 * POST /api/auth/otp/verify
 * Exchange a Firebase Phone Auth ID token for Kasi to Kasi JWT tokens.
 * This is the only endpoint the app needs to call for OTP login/register.
 */
router.post(
  '/verify',
  body('firebaseIdToken').notEmpty().withMessage('firebaseIdToken is required'),
  body('name').optional().trim(),
  body('email').optional().isEmail().withMessage('Valid email required'),
  validate,
  ctrl.verifyOtp
);

/**
 * POST /api/auth/otp/link-password
 * Let an OTP user optionally add a password (requires existing JWT).
 */
router.post(
  '/link-password',
  authenticate,
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  validate,
  ctrl.linkPassword
);

/**
 * GET /api/auth/otp/status
 * Check phone verification status for the logged-in user.
 */
router.get('/status', authenticate, ctrl.otpStatus);

module.exports = router;
