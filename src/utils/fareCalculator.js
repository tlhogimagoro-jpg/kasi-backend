const config = require('../config');

/**
 * Haversine distance between two lat/lng points (in km).
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return (deg * Math.PI) / 180; }

/**
 * Calculate trip fare based on distance.
 */
function calculateFare(distanceKm) {
  const { base, perKm, minimum } = config.fare;
  const raw = base + distanceKm * perKm;
  return Math.max(minimum, Math.round(raw * 100) / 100);
}

/**
 * Split fare into the 4 recipients.
 * Returns rounded-to-cent values; any rounding remainder goes to driver.
 */
function splitFare(totalFare) {
  const { driver, platform, workshop, association } = config.paymentSplit;

  const platformAmount   = round2(totalFare * platform);
  const workshopAmount   = round2(totalFare * workshop);
  const associationAmount = round2(totalFare * association);
  // Driver gets the remainder so splits always sum to total
  const driverAmount = round2(totalFare - platformAmount - workshopAmount - associationAmount);

  return { totalFare, driverAmount, platformAmount, workshopAmount, associationAmount };
}

/**
 * Courier fee: base R15 + R2/km × size multiplier.
 */
function calculateCourierFee(distanceKm, packageSize) {
  const multipliers = { SMALL: 1.0, MEDIUM: 1.3, LARGE: 1.6, EXTRA_LARGE: 2.0 };
  const mult = multipliers[packageSize] || 1.0;
  return round2((15 + distanceKm * 2) * mult);
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { haversineKm, calculateFare, splitFare, calculateCourierFee };
