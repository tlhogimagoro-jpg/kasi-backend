const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/courierController');
const { authenticate, requireDriver } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(authenticate);

router.post('/bookings',
  body('recipientName').trim().notEmpty(),
  body('recipientPhone').trim().notEmpty(),
  body('pickup').notEmpty(),
  body('dropoff').notEmpty(),
  validate, ctrl.bookCourier
);

router.get('/bookings', ctrl.getMyBookings);
router.get('/bookings/available', ctrl.getAvailableJobs);
router.get('/bookings/:id', ctrl.getCourierBooking);
router.put('/bookings/:id/cancel', ctrl.cancelBooking);

// Driver-only actions
router.put('/bookings/:id/accept', requireDriver, ctrl.acceptJob);
router.put('/bookings/:id/collect', requireDriver, ctrl.markCollected);
router.put('/bookings/:id/deliver', requireDriver, ctrl.markDelivered);

module.exports = router;
