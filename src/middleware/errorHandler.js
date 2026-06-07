const logger = require('../config/logger');

function errorHandler(err, req, res, next) {
  logger.error(`${req.method} ${req.path} — ${err.message}`, { stack: err.stack });

  // Prisma known errors
  if (err.code === 'P2002') {
    return res.status(409).json({ success: false, error: 'A record with that value already exists' });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, error: 'Record not found' });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
}

module.exports = errorHandler;
