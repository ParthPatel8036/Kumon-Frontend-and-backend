import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import db from './db.js';

import authRoutes from './routes/auth.js';
import studentRoutes from './routes/students.js';
import guardianRoutes from './routes/guardians.js';
import scanRoutes from './routes/scans.js';
import messageRoutes from './routes/messages.js';
import templatesRouter from "./routes/templates.js";
import qrRoutes from './routes/qr.js';
import importRoutes from './routes/import.js';
import usersRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// --- CORS (multi-origin whitelist) ---
// Fallback defaults cover prod + common local dev ports if env is empty.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.kumonnorthhobartapp.com',
  'https://kumonnorthhobartapp.com',
  'http://localhost:5173',
  'http://localhost:3000'
];

function normalizeOrigin(s) {
  return s.trim().replace(/\/+$/, '');
}

const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s && normalizeOrigin(s))
  .filter(Boolean);

const allowedOrigins = (envOrigins.length ? envOrigins : DEFAULT_ALLOWED_ORIGINS).map(normalizeOrigin);

// Helpful visibility at boot
console.log('[CORS] Allowed origins:', allowedOrigins);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // allow non-browser requests
    if (allowedOrigins.includes(normalizeOrigin(origin))) return callback(null, true);
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,                      // <-- allow cookies/credentials
  optionsSuccessStatus: 204,              // <-- preflight OK status
  preflightContinue: false
};

app.use(cors(corsOptions));
// Ensure all preflight (OPTIONS) requests are handled early
app.options(/.*/, cors(corsOptions));

// Parsers
app.use(cookieParser());
app.use(express.json());

// Health
app.get('/', (req, res) => {
  res.send('Kumon API is running!');
});

// Routes
app.use('/auth', authRoutes);
app.use('/students', studentRoutes);
app.use('/guardians', guardianRoutes);
app.use('/scan', scanRoutes);
app.use('/messages', messageRoutes);
app.use('/templates', templatesRouter);
app.use('/qr', qrRoutes);
app.use('/import', importRoutes);
app.use('/users', usersRoutes);
app.use('/settings', settingsRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

// Start only after DB is reachable
async function start() {
  try {
    await db.query('SELECT 1'); // warm-up ping
    console.log('DB ping OK. Starting server...');
    app.listen(PORT, () => {
      console.log(`Server listening on ${PORT}`);
    });
  } catch (e) {
    console.error('DB connection failed at startup:', e.message);
    process.exit(1);
  }
}
start();