const prisma = require('../config/prisma');
const { ok, created, badRequest, notFound, serverError } = require('../utils/response');
const { matchRoutes } = require('../utils/routeMatcher');
const { calculateFare, splitFare, haversineKm } = require('../utils/fareCalculator');
const { notify } = require('../services/notificationService');
const { emitTripStatus, emitToUser } = require('../services/socketService');
const logger = require('../config/logger');

let _io; // injected from server.js
function setIo(io) { _io = io; }

// GET /api/passenger/routes/nearby
async function getNearbyRoutes(req, res) {
  try {
    const { lat, lng, destLat, destLng, radius = 2 } = req.query;
    if (!lat || !lng || !destLat || !destLng) return badRequest(res, 'lat, lng, destLat, destLng required');

    const activeRoutes = await prisma.route.findMany({
      where: { isActive: true, availableSeats: { gt: 0 } },
      include: {
        driver: {
          select: { id: true, name: true, rating: true, profileImageUrl: true,
            driverProfile: { select: { vehicleReg: true, vehicleMake: true, vehicleModel: true, vehicleColor: true, isOnline: true, currentLat: true, currentLng: true } }
          }
        }
      },
    });

    const matched = matchRoutes(
      activeRoutes,
      parseFloat(lat), parseFloat(lng),
      parseFloat(destLat), parseFloat(destLng)
    );

    // Shape response for Android app
    const result = matched.slice(0, 10).map(r => ({
      id: r.id,
      driverId: r.driver.id,
      driverName: r.driver.name,
      driverRating: r.driver.rating,
      vehicleReg: r.driver.driverProfile?.vehicleReg,
      vehicleMake: r.driver.driverProfile?.vehicleMake,
      vehicleColor: r.driver.driverProfile?.vehicleColor,
      origin: { name: r.originName, latLng: { latitude: r.originLat, longitude: r.originLng } },
      destination: { name: r.destinationName, latLng: { latitude: r.destinationLat, longitude: r.destinationLng } },
      currentPosition: { latitude: r.currentLat ?? r.originLat, longitude: r.currentLng ?? r.originLng },
      availableSeats: r.availableSeats,
      totalSeats: r.totalSeats,
      estimatedFare: r.estimatedFare,
      pickupDetourKm: r.pickupDetourKm,
      isActive: r.isActive,
      departureTime: r.departureTime,
    }));

    return ok(res, result);
  } catch (err) {
    logger.error('getNearbyRoutes:', err);
    return serverError(res);
  }
}

// POST /api/passenger/trips
async function requestTrip(req, res) {
  try {
    const { pickupLat, pickupLng, pickupName, dropoffLat, dropoffLng, dropoffName, paymentMethod } = req.body;

    const distanceKm = haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
    const fare = calculateFare(distanceKm);

    const trip = await prisma.trip.create({
      data: {
        passengerId: req.user.id,
        pickupName, pickupLat: parseFloat(pickupLat), pickupLng: parseFloat(pickupLng),
        dropoffName, dropoffLat: parseFloat(dropoffLat), dropoffLng: parseFloat(dropoffLng),
        fare,
        distanceKm,
        status: 'SEARCHING',
        paymentMethod: paymentMethod || 'CASH',
      },
    });

    // Find and notify nearby online drivers
    const nearbyDrivers = await prisma.driverProfile.findMany({
      where: { isOnline: true, currentLat: { not: null } },
    });

    for (const dp of nearbyDrivers) {
      const dist = haversineKm(pickupLat, pickupLng, dp.currentLat, dp.currentLng);
      if (dist <= 3) {
        emitToUser(_io, dp.userId, 'trip:new_request', { ...trip, distanceFromDriver: dist });
        await notify.newTripRequest(dp.userId, pickupName, dropoffName, fare);
      }
    }

    return created(res, trip, 'Trip request created');
  } catch (err) {
    logger.error('requestTrip:', err);
    return serverError(res);
  }
}

// GET /api/passenger/trips/:tripId
async function getTripStatus(req, res) {
  try {
    const trip = await prisma.trip.findFirst({
      where: { id: req.params.tripId, passengerId: req.user.id },
      include: {
        driver: { select: { name: true, rating: true, profileImageUrl: true,
          driverProfile: { select: { vehicleReg: true, vehicleMake: true, vehicleColor: true, currentLat: true, currentLng: true } }
        }},
        payment: true,
      },
    });
    if (!trip) return notFound(res, 'Trip not found');
    return ok(res, trip);
  } catch (err) {
    return serverError(res);
  }
}

// PUT /api/passenger/trips/:tripId/cancel
async function cancelTrip(req, res) {
  try {
    const trip = await prisma.trip.findFirst({
      where: { id: req.params.tripId, passengerId: req.user.id },
    });
    if (!trip) return notFound(res);
    if (!['SEARCHING', 'MATCHED'].includes(trip.status)) {
      return badRequest(res, 'Trip cannot be cancelled at this stage');
    }

    const updated = await prisma.trip.update({
      where: { id: trip.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: req.body.reason || 'Passenger cancelled' },
    });

    if (trip.driverId) emitTripStatus(_io, trip.id, 'CANCELLED', 'Passenger cancelled the trip');
    return ok(res, updated, 'Trip cancelled');
  } catch (err) {
    return serverError(res);
  }
}

// GET /api/passenger/trips/history
async function getTripHistory(req, res) {
  try {
    const { page = 0, size = 20 } = req.query;
    const trips = await prisma.trip.findMany({
      where: { passengerId: req.user.id },
      orderBy: { requestedAt: 'desc' },
      skip: parseInt(page) * parseInt(size),
      take: parseInt(size),
      include: { payment: true, rating: true },
    });
    return ok(res, trips);
  } catch (err) {
    return serverError(res);
  }
}

// POST /api/passenger/trips/:tripId/rate
async function rateTrip(req, res) {
  try {
    const { rating, comment } = req.body;
    const trip = await prisma.trip.findFirst({
      where: { id: req.params.tripId, passengerId: req.user.id, status: 'COMPLETED' },
    });
    if (!trip) return notFound(res, 'Completed trip not found');
    if (!trip.driverId) return badRequest(res, 'No driver to rate');

    const existing = await prisma.rating.findUnique({ where: { tripId: trip.id } });
    if (existing) return badRequest(res, 'Trip already rated');

    await prisma.rating.create({
      data: { tripId: trip.id, giverId: req.user.id, receiverId: trip.driverId, score: parseFloat(rating), comment: comment || null },
    });

    // Recalculate driver average rating
    const agg = await prisma.rating.aggregate({ where: { receiverId: trip.driverId }, _avg: { score: true } });
    await prisma.user.update({ where: { id: trip.driverId }, data: { rating: agg._avg.score || 5.0 } });

    return ok(res, null, 'Rating submitted');
  } catch (err) {
    return serverError(res);
  }
}

module.exports = { getNearbyRoutes, requestTrip, getTripStatus, cancelTrip, getTripHistory, rateTrip, setIo };
