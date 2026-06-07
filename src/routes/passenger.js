const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const ctrl = require('../controllers/passengerController');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(authenticate);

router.get('/routes/nearby',
  query('lat').isFloat(), query('lng').isFloat(),
  query('destLat').isFloat(), query('destLng').isFloat(),
  validate, ctrl.getNearbyRoutes
);

router.post('/trips',
  body('pickupLat').isFloat(), body('pickupLng').isFloat(),
  body('pickupName').trim().notEmpty(),
  body('dropoffLat').isFloat(), body('dropoffLng').isFloat(),
  body('dropoffName').trim().notEmpty(),
  validate, ctrl.requestTrip
);

router.get('/trips/history', ctrl.getTripHistory);
router.get('/trips/:tripId', ctrl.getTripStatus);
router.put('/trips/:tripId/cancel', ctrl.cancelTrip);
router.post('/trips/:tripId/rate',
  body('rating').isFloat({ min: 1, max: 5 }),
  validate, ctrl.rateTrip
);

module.exports = router;
