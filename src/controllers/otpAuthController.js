// src/controllers/otpAuthController.js
//
// Firebase Phone Auth OTP flow:
//
//  ANDROID APP                        BACKEND
//  ──────────────────────────────────────────────────────
//  1. User enters phone number
//  2. App calls Firebase Auth SDK      (no backend call needed)
//     → Firebase sends SMS to user
//  3. User types the 6-digit OTP
//  4. App verifies OTP with Firebase
//     → Firebase returns an idToken
//  5. App sends idToken to backend  →  POST /api/auth/otp/verify
//  6. Backend verifies token with      (this file handles steps 5-6)
//     Firebase Admin SDK
//  7. Backend finds or creates user
//  8. Backend returns JWT tokens    →  App stores tokens, user is logged in
//
// Why this design?
//   Firebase handles the actual SMS delivery and OTP verification.
//   The backend only needs to validate the resulting Firebase ID token —
//   it never sees or stores OTP codes.

const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { getAdmin } = require('../config/firebase');
const { jwt: jwtConfig } = require('../config');
const { ok, created, badRequest, unauthorized, serverError } = require('../utils/response');
const logger = require('../config/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────

function signTokens(userId) {
  const accessToken = jwt.sign(
    { userId },
    jwtConfig.secret,
    { expiresIn: jwtConfig.expiresIn }
  );
  const refreshToken = jwt.sign(
    { userId },
    jwtConfig.refreshSecret,
    { expiresIn: jwtConfig.refreshExpiresIn }
  );
  return { accessToken, refreshToken };
}

function sanitizeUser(user) {
  const { passwordHash, refreshToken, ...safe } = user;
  return safe;
}

// Normalise phone numbers to E.164 format (e.g. 0812345678 → +27812345678)
function normalisePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  // South African numbers: 10 digits starting with 0 → replace leading 0 with +27
  if (digits.length === 10 && digits.startsWith('0')) {
    return `+27${digits.slice(1)}`;
  }
  // Already has country code (11+ digits)
  if (digits.length >= 11) return `+${digits}`;
  return `+${digits}`;
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * POST /api/auth/otp/verify
 *
 * Called by the Android app AFTER Firebase Phone Auth succeeds on the device.
 * The app sends the Firebase ID token; we verify it server-side and return
 * our own JWT pair.
 *
 * Body: {
 *   firebaseIdToken: string   — from FirebaseAuth.currentUser.getIdToken()
 *   name?: string             — required on first registration
 *   email?: string            — optional
 * }
 */
async function verifyOtp(req, res) {
  try {
    const { firebaseIdToken, name, email } = req.body;

    if (!firebaseIdToken) {
      return badRequest(res, 'firebaseIdToken is required');
    }

    const admin = getAdmin();
    if (!admin) {
      return serverError(res, 'Firebase is not configured on this server');
    }

    // ── Step 1: Verify the Firebase ID token ──────────────────────────────
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(firebaseIdToken);
    } catch (firebaseErr) {
      logger.warn(`Firebase token verification failed: ${firebaseErr.message}`);
      return unauthorized(res, 'Invalid or expired Firebase token');
    }

    const firebaseUid  = decodedToken.uid;
    const firebasePhone = decodedToken.phone_number; // E.164 e.g. +27812345678

    if (!firebasePhone) {
      return badRequest(res, 'Token does not contain a phone number — ensure Phone Auth is enabled in Firebase');
    }

    // ── Step 2: Find or create the user ───────────────────────────────────
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: firebasePhone },
          { firebaseUid },
        ],
      },
      include: { driverProfile: true },
    });

    const isNewUser = !user;

    if (isNewUser) {
      // New user — name is required
      if (!name || name.trim().length === 0) {
        return badRequest(res, 'name is required for new accounts');
      }

      user = await prisma.user.create({
        data: {
          name: name.trim(),
          phone: firebasePhone,
          email: email?.trim() || null,
          firebaseUid,
          // No passwordHash — OTP users authenticate via Firebase only
          passwordHash: '',
          isPhoneVerified: true,
        },
        include: { driverProfile: true },
      });

      logger.info(`New user via OTP: ${user.id} (${firebasePhone})`);
    } else {
      // Returning user — update firebaseUid if missing, mark phone verified
      if (!user.firebaseUid || !user.isPhoneVerified) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            firebaseUid,
            isPhoneVerified: true,
            ...(email && !user.email ? { email: email.trim() } : {}),
          },
          include: { driverProfile: true },
        });
      }
    }

    if (!user.isActive) {
      return unauthorized(res, 'Account has been deactivated');
    }

    // ── Step 3: Issue JWT tokens ───────────────────────────────────────────
    const tokens = signTokens(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    return (isNewUser ? created : ok)(
      res,
      {
        accessToken:  tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: sanitizeUser(user),
        isNewUser,
      },
      isNewUser ? 'Account created successfully' : 'Login successful'
    );

  } catch (err) {
    logger.error('verifyOtp error:', err);
    return serverError(res);
  }
}

/**
 * POST /api/auth/otp/link-password
 *
 * Lets an OTP user add a password to their account (optional).
 * Useful if they want to fall back to password login.
 */
async function linkPassword(req, res) {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return badRequest(res, 'Password must be at least 6 characters');
    }

    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: hash },
    });

    return ok(res, null, 'Password set successfully');
  } catch (err) {
    logger.error('linkPassword error:', err);
    return serverError(res);
  }
}

/**
 * GET /api/auth/otp/status
 *
 * Returns whether the currently authenticated user's phone is verified.
 * Useful for the app to decide which login screen to show.
 */
async function otpStatus(req, res) {
  return ok(res, {
    phoneVerified: req.user.isPhoneVerified,
    phone: req.user.phone,
    hasPassword: !!req.user.passwordHash && req.user.passwordHash.length > 0,
  });
}

module.exports = { verifyOtp, linkPassword, otpStatus };
