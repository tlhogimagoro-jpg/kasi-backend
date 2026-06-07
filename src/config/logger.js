const { createLogger, format, transports } = require('winston');
const { isDev } = require('./index');

const logger = createLogger({
  level: isDev ? 'debug' : 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    isDev
      ? format.combine(format.colorize(), format.printf(({ timestamp, level, message, stack }) =>
          `${timestamp} [${level}]: ${stack || message}`))
      : format.json()
  ),
  transports: [
    new transports.Console(),
    ...(isDev ? [] : [
      new transports.File({ filename: 'logs/error.log', level: 'error' }),
      new transports.File({ filename: 'logs/combined.log' }),
    ]),
  ],
});

module.exports = logger;
