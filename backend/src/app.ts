import express from 'express';
import cors from 'cors';
import compression from 'compression';
import logger from './config/logger';
import apiRouter from './routes/index';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// HTTP response compression (gzip/brotli) — applied before routing so all
// responses benefit. Especially impactful for the ~6 MB word-list endpoint.
app.use(compression());

// CORS
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(cors({
  origin: corsOrigin.includes(',') ? corsOrigin.split(',').map(s => s.trim()) : corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, _res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
});

// Mount all API routes under /api
app.use('/api', apiRouter);

// 404 handler for unmatched routes
app.use((_req, res) => {
  res.status(404).json({
    error: {
      message: 'Route not found',
      code: 'ERR_NOT_FOUND',
    },
  });
});

// Global error handler
app.use(errorHandler);

export default app;
