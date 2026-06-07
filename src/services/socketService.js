const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config');
const logger = require('../config/logger');
const prisma = require('../config/prisma');

// In-memory driver location store (per driver ID)
const driverLocations = new Map();
// Map socket.id → userId
const socketToUser = new Map();
// Map userId → socket.id
const userToSocket = new Map();

/**
 * Attach Socket.IO event handlers to an io instance.
 * Called once from server.js after io is created.
 */
function initSocket(io) {
  // Authenticate socket connections via JWT in handshake
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No token'));
      const decoded = jwt.verify(token, jwtConfig.secret);
      socket.userId = decoded.userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    socketToUser.set(socket.id, userId);
    userToSocket.set(userId, socket.id);
    logger.debug(`Socket connected: user=${userId}`);

    // ── Driver: broadcast real-time location ──────────────────────────
    socket.on('driver:location_update', async (data) => {
      const { lat, lng, heading, speed } = data;
      if (!lat || !lng) return;

      driverLocations.set(userId, { lat, lng, heading: heading || 0, speed: speed || 0, updatedAt: Date.now() });

      // Update DB (debounced via in-memory; persisted every 10s via background task)
      // Broadcast to all passengers watching this driver
      socket.to(`driver:${userId}`).emit('driver:location', {
        driverId: userId,
        lat, lng, heading: heading || 0, speed: speed || 0,
      });

      // Also update active trip rooms
      const activeTrip = await prisma.trip.findFirst({
        where: { driverId: userId, status: { in: ['DRIVER_EN_ROUTE', 'IN_PROGRESS'] } },
        select: { id: true },
      });
      if (activeTrip) {
        io.to(`trip:${activeTrip.id}`).emit('driver:location', {
          driverId: userId, lat, lng, heading: heading || 0, speed: speed || 0,
        });
      }
    });

    // ── Join a trip room (passenger + driver) ─────────────────────────
    socket.on('join:trip', ({ tripId }) => {
      if (!tripId) return;
      socket.join(`trip:${tripId}`);
      logger.debug(`User ${userId} joined trip room: ${tripId}`);
    });

    // ── Follow a driver's location ─────────────────────────────────────
    socket.on('follow:driver', ({ driverId }) => {
      if (!driverId) return;
      socket.join(`driver:${driverId}`);
      // Send last known location immediately
      const loc = driverLocations.get(driverId);
      if (loc) socket.emit('driver:location', { driverId, ...loc });
    });

    socket.on('disconnect', () => {
      socketToUser.delete(socket.id);
      userToSocket.delete(userId);
      logger.debug(`Socket disconnected: user=${userId}`);
    });
  });

  // Background: persist driver locations to DB every 10 seconds
  setInterval(async () => {
    for (const [driverId, loc] of driverLocations.entries()) {
      if (Date.now() - loc.updatedAt > 30_000) {
        driverLocations.delete(driverId); // Remove stale entries
        continue;
      }
      await prisma.driverProfile.updateMany({
        where: { userId: driverId },
        data: { currentLat: loc.lat, currentLng: loc.lng, currentHeading: loc.heading, lastSeenAt: new Date() },
      }).catch(() => {});
    }
  }, 10_000);

  return { driverLocations, userToSocket };
}

/**
 * Emit a trip status change to all parties in a trip room.
 */
function emitTripStatus(io, tripId, status, message = '') {
  io.to(`trip:${tripId}`).emit('trip:status', { tripId, status, message });
}

/**
 * Notify a specific user via their socket.
 */
function emitToUser(io, userId, event, data) {
  const socketId = userToSocket.get(userId);
  if (socketId) io.to(socketId).emit(event, data);
}

module.exports = { initSocket, emitTripStatus, emitToUser, driverLocations };
