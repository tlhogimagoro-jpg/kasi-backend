// src/config/firebase.js
// Single Firebase Admin instance shared by all services.
// notificationService.js previously initialised its own — this replaces that pattern.

const logger = require('./logger');

let admin = null;

function getAdmin() {
  if (admin) return admin;

  try {
    const firebaseAdmin = require('firebase-admin');
    const config = require('./index');

    if (!config.firebase.projectId || !config.firebase.privateKey) {
      logger.warn('Firebase credentials not set — phone OTP and push notifications disabled');
      return null;
    }

    // Avoid duplicate app initialisation (e.g. hot-reloads in dev)
    if (firebaseAdmin.apps.length === 0) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert({
          projectId:   config.firebase.projectId,
          privateKey:  config.firebase.privateKey,
          clientEmail: config.firebase.clientEmail,
        }),
      });
      logger.info('✅ Firebase Admin SDK initialised');
    }

    admin = firebaseAdmin;
    return admin;
  } catch (err) {
    logger.error('Firebase Admin init failed:', err.message);
    return null;
  }
}

module.exports = { getAdmin };
