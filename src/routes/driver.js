const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/driverController');
const { authenticate, requireDriver } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(authenticate, requireDriver);

router.put('/go-online',
  body('lat').isFloat(), body('lng').isFloat(),
  validate, ctrl.goOnline
);
router.put('/go-offline', ctrl.goOffline);

router.post('/routes',
  body('originLat').isFloat(), body('originLng').isFloat(),
  body('originName').trim().notEmpty(),
  body('destinationLat').isFloat(), body('destinationLng').isFloat(),
  body('destinationName').trim().notEmpty(),
  body('availableSeats').isInt({ min: 1, max: 22 }),
  body('departureTime').notEmpty(),
  validate, ctrl.createRoute
);

router.get('/routes/active', ctrl.getActiveRoute);
router.put('/routes/:routeId/complete', ctrl.completeRoute);
router.get('/trips/pending', ctrl.getPendingTrips);
router.put('/trips/:tripId/accept', ctrl.acceptTrip);
router.put('/trips/:tripId/pickup', ctrl.confirmPickup);
router.put('/trips/:tripId/complete', ctrl.completeTrip);
router.get('/earnings', ctrl.getEarnings);

module.exports = router;
