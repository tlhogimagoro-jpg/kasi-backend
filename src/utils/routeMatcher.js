const { haversineKm } = require('./fareCalculator');

/**
 * Dynamic Route Matcher
 *
 * Finds active routes where a mid-route pickup makes sense for a passenger.
 * Strategy:
 *   1. Driver must be heading roughly toward the passenger's pickup
 *   2. Passenger's drop-off must be along or near the driver's remaining path
 *   3. Route must have available seats
 *   4. Score routes and return sorted best-first
 */

const MAX_PICKUP_DETOUR_KM = 2.0;   // How far off-route a pickup can be
const MAX_DROPOFF_DETOUR_KM = 2.5;  // How far off-route a drop-off can be

/**
 * @param {Array} activeRoutes  - from DB, with driver current position
 * @param {number} pickupLat
 * @param {number} pickupLng
 * @param {number} destLat
 * @param {number} destLng
 * @returns {Array} sorted matched routes with estimated fare
 */
function matchRoutes(activeRoutes, pickupLat, pickupLng, destLat, destLng) {
  const matches = [];

  for (const route of activeRoutes) {
    if (!route.isActive || route.availableSeats <= 0) continue;

    const driverLat = route.currentLat ?? route.originLat;
    const driverLng = route.currentLng ?? route.originLng;

    // Distance from driver's current position to passenger's pickup
    const pickupDetour = haversineKm(driverLat, driverLng, pickupLat, pickupLng);

    // Distance from passenger's drop-off to route's destination
    const dropoffDetour = haversineKm(destLat, destLng, route.destinationLat, route.destinationLng);

    // Passenger's trip distance
    const tripDistanceKm = haversineKm(pickupLat, pickupLng, destLat, destLng);

    if (pickupDetour > MAX_PICKUP_DETOUR_KM) continue;
    if (dropoffDetour > MAX_DROPOFF_DETOUR_KM) continue;

    // Score: lower is better (combines detours + remaining distance favors shorter waits)
    const score = pickupDetour * 2 + dropoffDetour + pickupDetour * 0.5;

    // Estimated fare for this passenger's segment
    const { calculateFare } = require('./fareCalculator');
    const fare = calculateFare(tripDistanceKm);

    matches.push({
      ...route,
      pickupDetourKm: Math.round(pickupDetour * 100) / 100,
      tripDistanceKm: Math.round(tripDistanceKm * 100) / 100,
      estimatedFare: fare,
      score,
    });
  }

  // Sort: best match first
  return matches.sort((a, b) => a.score - b.score);
}

module.exports = { matchRoutes };
