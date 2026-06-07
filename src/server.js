require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./config/logger');
const prisma = require('./config/prisma');
const errorHandler = require('./middleware/errorHandler');
const { initSocket } = require('./services/socketService');

// ── Route imports ─────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const passengerRoutes = require('./routes/passenger');
const driverRoutes    = require('./routes/driver');
const courierRoutes   = require('./routes/courier');
const paymentRoutes   = require('./routes/payments');

// ── Controller io injection ──────────────────────────────
const passengerCtrl = require('./controllers/passengerController');
const driverCtrl    = require('./controllers/driverController');
const courierCtrl   = require('./controllers/courierController');

const app = express();
const server = http.createServer(app);

// ── Socket.IO ─────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: config.cors.origins, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});
initSocket(io);

// Inject io into controllers that need to emit
passengerCtrl.setIo(io);
driverCtrl.setIo(io);
courierCtrl.setIo(io);

// ── Middleware ────────────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({ origin: config.cors.origins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(config.isDev ? 'dev' : 'combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Rate limiting
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { success: false, error: 'Too many requests' } }));
app.use('/api', rateLimit({ windowMs: 1 * 60 * 1000, max: 120 }));

// ── Health check ──────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', service: 'Kasi to Kasi API', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

// ── API Routes ────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/passenger', passengerRoutes);
app.use('/api/driver',    driverRoutes);
app.use('/api/courier',   courierRoutes);
app.use('/api/payments',  paymentRoutes);

// ── 404 catch-all ─────────────────────────────────────────
app.use((req, res) => res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` }));

// ── Global error handler ──────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────
async function start() {
  try {
    await prisma.$connect();
    logger.info('✅ Database connected');

    server.listen(config.port, () => {
      logger.info(`🚕 Kasi to Kasi API running on port ${config.port} [${config.nodeEnv}]`);
      logger.info(`   Health: http://localhost:${config.port}/health`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down');
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});

start();
