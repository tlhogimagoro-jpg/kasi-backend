// src/routes/auth.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.post('/register',
  body('name').trim().notEmpty().withMessage('Name required'),
  body('phone').trim().isMobilePhone().withMessage('Valid phone required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  validate, ctrl.register
);

router.post('/login',
  body('phone').trim().notEmpty(),
  body('password').notEmpty(),
  validate, ctrl.login
);

router.post('/refresh', ctrl.refresh);
router.get('/profile', authenticate, ctrl.getProfile);
router.put('/profile', authenticate, ctrl.updateProfile);
router.post('/logout', authenticate, ctrl.logout);

// Firebase Phone Auth (OTP) sub-routes
router.use('/otp', require('./otp'));

module.exports = router;
