const { v4: uuid } = require('uuid');
const prisma = require('../config/prisma');
const { ok, created, badRequest, notFound, serverError } = require('../utils/response');
const { calculateCourierFee, haversineKm, splitFare } = require('../utils/fareCalculator');
const { notify } = require('../services/notificationService');
const logger = require('../config/logger');

let _io;
function setIo(io) { _io = io; }

function generateTrackingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'KTK-' + Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// POST /api/courier/bookings
async function bookCourier(req, res) {
  try {
    const { recipientName, recipientPhone, pickup, dropoff, packageSize, packageDescription, isFragile } = req.body;

    const distanceKm = haversineKm(pickup.latLng.latitude, pickup.latLng.longitude, dropoff.latLng.latitude, dropoff.latLng.longitude);
    const fee = calculateCourierFee(distanceKm, packageSize || 'SMALL');

    const booking = await prisma.courierBooking.create({
      data: {
        senderId: req.user.id,
        recipientName,
        recipientPhone,
        pickupName: pickup.name,
        pickupLat: pickup.latLng.latitude,
        pickupLng: pickup.latLng.longitude,
        dropoffName: dropoff.name,
        dropoffLat: dropoff.latLng.latitude,
        dropoffLng: dropoff.latLng.longitude,
        packageSize: packageSize || 'SMALL',
        packageDescription: packageDescription || null,
        isFragile: isFragile || false,
        estimatedFee: fee,
        trackingCode: generateTrackingCode(),
      },
    });

    // Notify nearby online drivers about this courier job
    const onlineDrivers = await prisma.driverProfile.findMany({ where: { isOnline: true, currentLat: { not: null } } });
    for (const dp of onlineDrivers) {
      const dist = haversineKm(pickup.latLng.latitude, pickup.latLng.longitude, dp.currentLat, dp.currentLng);
      if (dist <= 5) await notify.courierUpdate(dp.userId, 'NEW JOB', booking.trackingCode);
    }

    return created(res, booking, 'Courier booking created');
  } catch (err) {
    logger.error('bookCourier:', err);
    return serverError(res);
  }
}

// GET /api/courier/bookings (sender's own bookings)
async function getMyBookings(req, res) {
  try {
    const bookings = await prisma.courierBooking.findMany({
      where: { senderId: req.user.id },
      orderBy: { bookedAt: 'desc' },
    });
    return ok(res, bookings);
  } catch (err) {
    return serverError(res);
  }
}

// GET /api/courier/bookings/:id
async function getCourierBooking(req, res) {
  try {
    const b = await prisma.courierBooking.findFirst({
      where: { id: req.params.id, OR: [{ senderId: req.user.id }, { assignedDriverId: req.user.id }] },
    });
    if (!b) return notFound(res);
    return ok(res, b);
  } catch (err) {
    return serverError(res);
  }
}

// PUT /api/courier/bookings/:id/cancel
async function cancelBooking(req, res) {
  try {
    const b = await prisma.courierBooking.findFirst({ where: { id: req.params.id, senderId: req.user.id } });
    if (!b) return notFound(res);
    if (!['PENDING', 'ACCEPTED'].includes(b.status)) return badRequest(res, 'Cannot cancel at this stage');

    const updated = await prisma.courierBooking.update({
      where: { id: b.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    return ok(res, updated, 'Booking cancelled');
  } catch (err) {
    return serverError(res);
  }
}

// GET /api/courier/bookings/available (driver-side)
async function getAvailableJobs(req, res) {
  try {
    const { lat, lng } = req.query;
    const jobs = await prisma.courierBooking.findMany({ where: { status: 'PENDING' } });
    if (!lat || !lng) return ok(res, jobs);

    const nearby = jobs
      .map(j => ({ ...j, distanceKm: haversineKm(parseFloat(lat), parseFloat(lng), j.pickupLat, j.pickupLng) }))
      .filter(j => j.distanceKm <= 10)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return ok(res, nearby);
  } catch (err) {
    return serverError(res);
  }
}

// PUT /api/courier/bookings/:id/accept (driver)
async function acceptJob(req, res) {
  try {
    const b = await prisma.courierBooking.findUnique({ where: { id: req.params.id } });
    if (!b) return notFound(res);
    if (b.status !== 'PENDING') return badRequest(res, 'Job no longer available');

    const updated = await prisma.courierBooking.update({
      where: { id: b.id },
      data: { status: 'ACCEPTED', assignedDriverId: req.user.id, acceptedAt: new Date() },
    });

    await notify.courierUpdate(b.senderId, 'ACCEPTED', b.trackingCode);
    return ok(res, updated, 'Job accepted');
  } catch (err) {
    return serverError(res);
  }
}

// PUT /api/courier/bookings/:id/collect (driver marks collected from sender)
async function markCollected(req, res) {
  try {
    const b = await prisma.courierBooking.findFirst({ where: { id: req.params.id, assignedDriverId: req.user.id } });
    if (!b) return notFound(res);

    const updated = await prisma.courierBooking.update({
      where: { id: b.id },
      data: { status: 'IN_TRANSIT', collectedAt: new Date() },
    });

    await notify.courierUpdate(b.senderId, 'IN TRANSIT', b.trackingCode);
    return ok(res, updated, 'Package collected — in transit');
  } catch (err) {
    return serverError(res);
  }
}

// PUT /api/courier/bookings/:id/deliver (driver marks delivered)
async function markDelivered(req, res) {
  try {
    const b = await prisma.courierBooking.findFirst({ where: { id: req.params.id, assignedDriverId: req.user.id } });
    if (!b) return notFound(res);

    const split = splitFare(b.estimatedFee);

    const [updated] = await prisma.$transaction([
      prisma.courierBooking.update({
        where: { id: b.id },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      }),
      prisma.payment.create({
        data: {
          courierBookingId: b.id,
          userId: b.senderId,
          totalAmount: split.totalFare,
          driverAmount: split.driverAmount,
          platformAmount: split.platformAmount,
          workshopAmount: split.workshopAmount,
          associationAmount: split.associationAmount,
          method: 'CASH',
          status: 'COMPLETED',
        },
      }),
      prisma.driverProfile.update({
        where: { userId: req.user.id },
        data: { totalEarnings: { increment: split.driverAmount } },
      }),
    ]);

    await notify.courierUpdate(b.senderId, 'DELIVERED', b.trackingCode);
    await notify.paymentReceived(req.user.id, split.driverAmount);

    return ok(res, updated, 'Delivery confirmed');
  } catch (err) {
    logger.error('markDelivered:', err);
    return serverError(res);
  }
}

module.exports = { bookCourier, getMyBookings, getCourierBooking, cancelBooking, getAvailableJobs, acceptJob, markCollected, markDelivered, setIo };
