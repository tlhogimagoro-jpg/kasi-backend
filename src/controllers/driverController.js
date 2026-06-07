const prisma = require('../config/prisma');
const { ok, created, badRequest, notFound, serverError } = require('../utils/response');
const { splitFare } = require('../utils/fareCalculator');
const { notify } = require('../services/notificationService');
const { emitTripStatus } = require('../services/socketService');
const logger = require('../config/logger');

let _io;
function setIo(io) { _io = io; }

// PUT /api/driver/go-online
async function goOnline(req, res) {
  try {
    const { lat, lng } = req.body;
    await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: { isOnline: true, currentLat: parseFloat(lat), currentLng: parseFloat(lng), lastSeenAt: new Date() },
    });
    return ok(res, null, 'You are now online');
  } catch (err) {
    return serverError(res);
  }
}

// PUT /api/driver/go-offline
async function goOffline(req, res) {
  try {
    await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: { isOnline: false },
    });
    return ok(res, null, 'You are now offline');
  } catch (err) {
    return serverError(res);
  }
}

// POST /api/driver/routes
async function createRoute(req, res) {
  try {
    const { originLat, originLng, originName, destinationLat, destinationLng, destinationName, availableSeats, departureTime } = req.body;

    // Close any existing active route first
    await prisma.route.updateMany({
      where: { driverId: req.user.id, isActive: true },
      data: { isActive: false, completedAt: new Date() },
    });

    const route = await prisma.route.create({
      data: {
        driverId: req.user.id,
        originName, originLat: parseFloat(originLat), originLng: parseFloat(originLng),
        destinationName, destinationLat: parseFloat(destinationLat), destinationLng: parseFloat(destinationLng),
        currentLat: parseFloat(originLat), currentLng: parseFloat(originLng),
        availableSeats: parseInt(availableSeats),
        departureTime: new Date(parseInt(departureTime)),
      },
    });

    await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: { activeRouteId: route.id },
    });

    return created(res, route, 'Route created');
  } catch (err) {
    logger.error('createRoute:', err);
    return serverError(res);
  }
}

// GET /api/driver/routes/active
async function getActiveRoute(req, res) {
  try {
    const route = await prisma.route.findFirst({
      where: { driverId: req.user.id, isActive: true },
      include: { trips: { where: { status: { in: ['MATCHED', 'DRIVER_EN_ROUTE', 'IN_PROGRESS'] } } } },
    });
    return ok(res, route);
  } catch (err) {
    return serverError(res);
  }
}

// PUT /api/driver/routes/:routeId/complete
async function completeRoute(req, res) {
  try {
    const route = await prisma.route.findFirst({ where: { id: req.params.routeId, driverId: req.user.id } });
    if (!route) return notFound(res);
    await prisma.route.update({ where: { id: route.id }, data: { isActive: false, completedAt: new Date() } });
    await prisma.driverProfile.update({ where: { userId: req.user.id }, data: { activeRouteId: null } });
    return ok(res, null, 'Route completed');
  } catch (err) {
    return serverError(res);
  }
}

// GET /api/driver/trips/pending
async function getPendingTrips(req, res) {
  try {
    const dp = await prisma.driverProfile.findUnique({ where: { userId: req.user.id } });
    if (!dp?.currentLat) return ok(res, []);

    // Trips near driver that are still searching
    const searching = await prisma.trip.findMany({
      where: { status: 'SEARCHING' },
      include: { passenger: { select: { name: true, rating: true } } },
    });

    const { haversineKm } = require('../utils/fareCalculator');
    const nearby = searching
      .filter(t => haversineKm(dp.currentLat, dp.currentLng, t.pickupLat, t.pickupLng) <= 5)
      .slice(0, 20);

    return ok(res, nearby);
  } catch (err) {
    return serverError(res);
  }
}

// PUT /api/driver/trips/:tripId/accept
async function acceptTrip(req, res) {
  try {
    const trip = await prisma.trip.findUnique({ where: { id: req.params.tripId } });
    if (!trip) return notFound(res);
    if (trip.status !== 'SEARCHING') return badRequest(res, 'Trip no longer available');

    const updated = await prisma.trip.update({
      where: { id: trip.id },
      data: { driverId: req.user.id, status: 'MATCHED', matchedAt: new Date() },
    });

    emitTripStatus(_io, trip.id, 'MATCHED', 'Driver accepted your trip');
    await notify.tripMatched(trip.passengerId, req.user.name);

    return ok(res, updated, 'Trip accepted');
  } catch (err) {
    return serverError(res);
  }
}

// PUT /api/driver/trips/:tripId/pickup
async function confirmPickup(req, res) {
  try {
    const trip = await prisma.trip.findFirst({ where: { id: req.params.tripId, driverId: req.user.id } });
    if (!trip) return notFound(res);

    const updated = await prisma.trip.update({
      where: { id: trip.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });

    emitTripStatus(_io, trip.id, 'IN_PROGRESS', 'Trip started');
    await notify.tripStarted(trip.passengerId);

    return ok(res, updated, 'Pickup confirmed — trip started');
  } catch (err) {
    return serverError(res);
  }
}

// PUT /api/driver/trips/:tripId/complete
async function completeTrip(req, res) {
  try {
    const trip = await prisma.trip.findFirst({ where: { id: req.params.tripId, driverId: req.user.id } });
    if (!trip) return notFound(res);
    if (trip.status !== 'IN_PROGRESS') return badRequest(res, 'Trip is not in progress');

    const split = splitFare(trip.fare);

    // Complete trip + create payment record in a transaction
    const [updatedTrip, payment] = await prisma.$transaction([
      prisma.trip.update({
        where: { id: trip.id },
        data: { status: 'COMPLETED', completedAt: new Date(), paymentSplit: split },
      }),
      prisma.payment.create({
        data: {
          tripId: trip.id,
          userId: trip.passengerId,
          totalAmount: split.totalFare,
          driverAmount: split.driverAmount,
          platformAmount: split.platformAmount,
          workshopAmount: split.workshopAmount,
          associationAmount: split.associationAmount,
          method: trip.paymentMethod,
          status: trip.paymentMethod === 'CASH' ? 'COMPLETED' : 'PENDING',
        },
      }),
    ]);

    // Update driver total earnings
    await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: { totalEarnings: { increment: split.driverAmount } },
    });

    // Update earnings snapshot for today
    const today = new Date(); today.setHours(0,0,0,0);
    await prisma.earningsSnapshot.upsert({
      where: { driverId_date: { driverId: req.user.id, date: today } },
      update: { tripCount: { increment: 1 }, totalFare: { increment: trip.fare }, driverEarnings: { increment: split.driverAmount } },
      create: { driverId: req.user.id, date: today, tripCount: 1, totalFare: trip.fare, driverEarnings: split.driverAmount },
    });

    // Update passenger trip count
    await prisma.user.update({ where: { id: trip.passengerId }, data: { totalTrips: { increment: 1 } } });

    emitTripStatus(_io, trip.id, 'COMPLETED', 'Trip completed');
    await notify.tripCompleted(trip.passengerId, trip.fare);
    await notify.paymentReceived(req.user.id, split.driverAmount);

    return ok(res, { ...updatedTrip, paymentSplit: split }, 'Trip completed');
  } catch (err) {
    logger.error('completeTrip:', err);
    return serverError(res);
  }
}

// GET /api/driver/earnings?period=week|month|all
async function getEarnings(req, res) {
  try {
    const { period = 'week' } = req.query;
    const now = new Date();
    let from;
    if (period === 'week') { from = new Date(now); from.setDate(from.getDate() - 7); }
    else if (period === 'month') { from = new Date(now); from.setDate(1); from.setHours(0,0,0,0); }

    const snapshots = await prisma.earningsSnapshot.findMany({
      where: { driverId: req.user.id, ...(from && { date: { gte: from } }) },
      orderBy: { date: 'asc' },
    });

    const totalFare    = snapshots.reduce((s, e) => s + e.totalFare, 0);
    const driverShare  = snapshots.reduce((s, e) => s + e.driverEarnings, 0);
    const tripCount    = snapshots.reduce((s, e) => s + e.tripCount, 0);

    return ok(res, {
      totalEarnings: Math.round(totalFare * 100) / 100,
      driverShare: Math.round(driverShare * 100) / 100,
      tripCount,
      period,
      breakdown: snapshots.map(s => ({
        date: s.date.toISOString().split('T')[0],
        amount: s.driverEarnings,
        trips: s.tripCount,
      })),
    });
  } catch (err) {
    return serverError(res);
  }
}

module.exports = { goOnline, goOffline, createRoute, getActiveRoute, completeRoute, getPendingTrips, acceptTrip, confirmPickup, completeTrip, getEarnings, setIo };
