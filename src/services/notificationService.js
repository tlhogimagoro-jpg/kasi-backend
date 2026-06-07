const logger = require('../config/logger');
const prisma = require('../config/prisma');
const { getAdmin } = require('../config/firebase');

/**
 * Send a push notification to a user and store it in DB.
 */
async function sendNotification(userId, type, title, message, metadata = {}) {
  try {
    // Persist to DB regardless of FCM
    await prisma.notification.create({
      data: { userId, type, title, message, metadata },
    });

    // FCM push if token exists
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } });
    const admin = getAdmin();
    if (admin && user?.fcmToken) {
      await admin.messaging().send({
        token: user.fcmToken,
        notification: { title, body: message },
        data: { type, ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)])) },
        android: { priority: 'high' },
      });
    }
  } catch (err) {
    logger.error('sendNotification error:', err.message);
  }
}

// Pre-built notification templates
const notify = {
  tripMatched: (passengerId, driverName) =>
    sendNotification(passengerId, 'TRIP_MATCHED', 'Driver Found! 🚕', `${driverName} is on the way`),

  driverArriving: (passengerId, minutesAway) =>
    sendNotification(passengerId, 'DRIVER_ARRIVING', 'Almost there!', `Your driver is ${minutesAway} min away`),

  tripStarted: (passengerId) =>
    sendNotification(passengerId, 'TRIP_STARTED', 'Trip Started 🛣️', 'Have a safe journey!'),

  tripCompleted: (passengerId, fare) =>
    sendNotification(passengerId, 'TRIP_COMPLETED', 'Trip Complete ✅', `Fare: R${fare.toFixed(2)}`),

  paymentReceived: (driverId, amount) =>
    sendNotification(driverId, 'PAYMENT_RECEIVED', 'Payment Received 💰', `R${amount.toFixed(2)} added to your earnings`),

  newTripRequest: (driverId, pickup, dropoff, fare) =>
    sendNotification(driverId, 'TRIP_MATCHED', 'New Trip Request 📍', `${pickup} → ${dropoff} · R${fare.toFixed(2)}`),

  courierUpdate: (userId, status, trackingCode) =>
    sendNotification(userId, 'COURIER_UPDATE', 'Parcel Update 📦', `Your parcel (${trackingCode}) is now ${status}`),
};

module.exports = { sendNotification, notify };
