const { validationResult } = require('express-validator');
const { validationError } = require('../utils/response');

/**
 * Run after express-validator chains.
 * Returns 422 with field errors if any rule failed.
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return validationError(res, errors.array().map(e => ({ field: e.path, message: e.msg })));
  }
  next();
}

module.exports = { validate };
