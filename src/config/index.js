require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  },

  flutterwave: {
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY,
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY,
    encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY,
  },

  cors: {
    origins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  },

  fare: {
    base: parseFloat(process.env.BASE_FARE_RANDS) || 8.0,
    perKm: parseFloat(process.env.FARE_PER_KM_RANDS) || 2.5,
    minimum: parseFloat(process.env.MINIMUM_FARE_RANDS) || 12.0,
  },

  paymentSplit: {
    driver: parseFloat(process.env.DRIVER_SHARE_PERCENT) / 100 || 0.75,
    platform: parseFloat(process.env.PLATFORM_SHARE_PERCENT) / 100 || 0.10,
    workshop: parseFloat(process.env.WORKSHOP_SHARE_PERCENT) / 100 || 0.08,
    association: parseFloat(process.env.ASSOCIATION_SHARE_PERCENT) / 100 || 0.07,
  },
};
