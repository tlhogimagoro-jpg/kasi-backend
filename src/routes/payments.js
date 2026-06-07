const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

// Webhook — no auth (Flutterwave calls this)
router.post('/webhook', ctrl.flutterwaveWebhook);

router.use(authenticate);
router.get('/history', ctrl.getPaymentHistory);
router.post('/initiate', ctrl.initiatePayment);

module.exports = router;
