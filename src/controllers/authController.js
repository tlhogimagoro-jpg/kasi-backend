const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const prisma = require('../config/prisma');
const { jwt: jwtConfig } = require('../config');
const { ok, created, badRequest, unauthorized, serverError } = require('../utils/response');
const logger = require('../config/logger');

function signTokens(userId) {
  const accessToken = jwt.sign({ userId }, jwtConfig.secret, { expiresIn: jwtConfig.expiresIn });
  const refreshToken = jwt.sign({ userId }, jwtConfig.refreshSecret, { expiresIn: jwtConfig.refreshExpiresIn });
  return { accessToken, refreshToken };
}

function sanitizeUser(user) {
  const { passwordHash, refreshToken, ...safe } = user;
  return safe;
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { name, phone, email, password } = req.body;

    const existing = await prisma.user.findFirst({ where: { OR: [{ phone }, ...(email ? [{ email }] : [])] } });
    if (existing) return badRequest(res, existing.phone === phone ? 'Phone number already registered' : 'Email already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, phone, email: email || null, passwordHash },
    });

    logger.info(`New user registered: ${user.id} (${phone})`);
    return created(res, sanitizeUser(user), 'Account created successfully');
  } catch (err) {
    logger.error('register error:', err);
    return serverError(res);
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { phone, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { driverProfile: true },
    });
    if (!user) return unauthorized(res, 'Invalid phone or password');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return unauthorized(res, 'Invalid phone or password');

    if (!user.isActive) return unauthorized(res, 'Account deactivated');

    const { accessToken, refreshToken } = signTokens(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    return ok(res, { accessToken, refreshToken }, 'Login successful');
  } catch (err) {
    logger.error('login error:', err);
    return serverError(res);
  }
}

// POST /api/auth/refresh
async function refresh(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return unauthorized(res, 'Refresh token required');

    const decoded = jwt.verify(refreshToken, jwtConfig.refreshSecret);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || user.refreshToken !== refreshToken) return unauthorized(res, 'Invalid refresh token');

    const tokens = signTokens(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: tokens.refreshToken } });

    return ok(res, tokens);
  } catch {
    return unauthorized(res, 'Invalid or expired refresh token');
  }
}

// GET /api/auth/profile
async function getProfile(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { driverProfile: true },
    });
    return ok(res, sanitizeUser(user));
  } catch (err) {
    return serverError(res);
  }
}

// PUT /api/auth/profile
async function updateProfile(req, res) {
  try {
    const { name, email, profileImageUrl, fcmToken } = req.body;
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(profileImageUrl && { profileImageUrl }),
        ...(fcmToken && { fcmToken }),
      },
    });
    return ok(res, sanitizeUser(updated), 'Profile updated');
  } catch (err) {
    return serverError(res);
  }
}

// POST /api/auth/logout
async function logout(req, res) {
  await prisma.user.update({ where: { id: req.user.id }, data: { refreshToken: null } }).catch(() => {});
  return ok(res, null, 'Logged out');
}

module.exports = { register, login, refresh, getProfile, updateProfile, logout };
