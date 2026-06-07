/**
 * Standardised API response helpers.
 * All responses follow: { success, data?, message?, error? }
 */

const ok = (res, data, message = 'Success', statusCode = 200) =>
  res.status(statusCode).json({ success: true, data, message });

const created = (res, data, message = 'Created') =>
  res.status(201).json({ success: true, data, message });

const badRequest = (res, error = 'Bad request') =>
  res.status(400).json({ success: false, error });

const unauthorized = (res, error = 'Unauthorized') =>
  res.status(401).json({ success: false, error });

const forbidden = (res, error = 'Forbidden') =>
  res.status(403).json({ success: false, error });

const notFound = (res, error = 'Not found') =>
  res.status(404).json({ success: false, error });

const serverError = (res, error = 'Internal server error') =>
  res.status(500).json({ success: false, error });

const validationError = (res, errors) =>
  res.status(422).json({ success: false, error: 'Validation failed', errors });

module.exports = { ok, created, badRequest, unauthorized, forbidden, notFound, serverError, validationError };
