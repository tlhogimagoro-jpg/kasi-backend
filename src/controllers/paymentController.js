const prisma = require('../config/prisma');
const { ok, serverError, notFound } = require('../utils/response');
const { splitFare } = require('../utils/fareCalculator');
const config = require('../config');
const logger = require('../config/logger');

// GET /api/payments/history
async function getPaymentHistory(req, res) {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { trip: { select: { pickupName: true, dropoffName: true } } },
    });
    return ok(res, payments);
  } catch (err) {
    return serverError(res);
  }
}

// POST /api/payments/initiate — initiate card payment via Flutterwave
async function initiatePayment(req, res) {
  try {
    const { tripId } = req.body;
    const trip = await prisma.trip.findFirst({ where: { id: tripId, passengerId: req.user.id } });
    if (!trip) return notFound(res, 'Trip not found');

    // Build Flutterwave payment link
    // In production, call the Flutterwave API here
    const reference = `KTK-${Date.now()}-${req.user.id.slice(0, 8)}`;
    const paymentUrl = `https://checkout.flutterwave.com/v3/hosted/pay?amount=${trip.fare}&currency=ZAR&tx_ref=${reference}&customer_email=${req.user.email || 'noemail@kasi.co.za'}&customer_name=${encodeURIComponent(req.user.name)}&meta[tripId]=${tripId}`;

    await prisma.payment.upsert({
      where: { tripId },
      update: { transactionRef: reference, status: 'PROCESSING' },
      create: {
        tripId,
        userId: req.user.id,
        totalAmount: trip.fare,
        ...splitFare(trip.fare),
        method: 'CARD',
        status: 'PROCESSING',
        transactionRef: reference,
      },
    });

    return ok(res, { paymentUrl, reference });
  } catch (err) {
    logger.error('initiatePayment:', err);
    return serverError(res);
  }
}

// POST /api/payments/webhook — Flutterwave webhook
async function flutterwaveWebhook(req, res) {
  try {
    const secretHash = config.flutterwave.secretKey;
    const signature = req.headers['verif-hash'];
    if (signature !== secretHash) return res.status(401).send('Invalid signature');

    const { data } = req.body;
    if (data?.status === 'successful') {
      const ref = data.tx_ref;
      await prisma.payment.updateMany({
        where: { transactionRef: ref },
        data: { status: 'COMPLETED', flutterwaveRef: String(data.id) },
      });
      // Mark trip payment complete
      const payment = await prisma.payment.findFirst({ where: { transactionRef: ref } });
      if (payment?.tripId) {
        await prisma.trip.update({ where: { id: payment.tripId }, data: { status: 'COMPLETED', completedAt: new Date() } });
      }
    }

    return res.status(200).send('OK');
  } catch (err) {
    logger.error('flutterwaveWebhook:', err);
    return res.status(500).send('Error');
  }
}

module.exports = { getPaymentHistory, initiatePayment, flutterwaveWebhook };
