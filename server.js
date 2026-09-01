const express = require('express');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { authenticateToken } = require('./middleware/auth');
const { enforceAccessPolicy } = require('./middleware/accessPolicy');
const { dynamicRateLimiter } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const gatewayRoutes = require('./routes/gateway');

const app = express();
app.use(express.json());

// ---- Request logging: writes to console + logs/access.log (simulates CloudWatch log ingestion) ----
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
const accessLogStream = fs.createWriteStream(path.join(logDir, 'access.log'), { flags: 'a' });
app.use(morgan('combined', { stream: accessLogStream }));
app.use(morgan('dev')); // also print to console

// ---- Public routes ----
app.use('/auth', authRoutes);

app.get('/', (req, res) => {
  res.json({
    message: 'API Rate Limiting & Security Gateway is running.',
    docs: 'POST /auth/login with {username, password}, then use the returned token as a Bearer token on /gateway/* routes.',
  });
});

// ---- Protected gateway routes: auth -> access policy -> rate limit -> service ----
app.use('/gateway', authenticateToken, enforceAccessPolicy, dynamicRateLimiter, gatewayRoutes);

// ---- Centralized error handler ----
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal gateway error.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API Gateway listening on http://localhost:${PORT}`);
});
