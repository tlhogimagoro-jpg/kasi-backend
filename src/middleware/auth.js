const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config');
const { unauthorized, forbidden } = require('../utils/response');
const prisma = require('../config/prisma');

/**
 * Verify JWT and attach user to req.user
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return unauthorized(res);

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, jwtConfig.secret);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { driverProfile: true },
    });

    if (!user || !user.isActive) return unauthorized(res, 'Account not found or deactivated');

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return unauthorized(res, 'Token expired');
    return unauthorized(res, 'Invalid token');
  }
}

/**
 * Require driver role + verified driver profile
 */
function requireDriver(req, res, next) {
  if (!req.user.driverProfile) return forbidden(res, 'Driver profile required');
  if (!req.user.isDriverVerified) return forbidden(res, 'Driver not yet verified');
  next();
}

/**
 * Require admin role
 */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN') return forbidden(res, 'Admin access required');
  next();
}

module.exports = { authenticate, requireDriver, requireAdmin };
