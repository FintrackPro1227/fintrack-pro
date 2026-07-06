// FinTrack Pro — Main Server
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fintrack-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));

// ── STATIC FILES ──
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── ROUTES ──
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.use('/api/clients',      require('./routes/clients'));
app.use('/api/documents',    require('./routes/documents'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/journal',      require('./routes/journal'));
app.use('/api/accounts',     require('./routes/accounts'));
app.use('/api/assets',       require('./routes/assets'));
app.use('/api/kasbank',      require('./routes/kasbank'));
app.use('/api/tax',          require('./routes/tax'));
app.use('/api/reports',      require('./routes/reports'));
app.use('/api/billing',      require('./routes/billing'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/ai',           require('./routes/ai'));

// ── CATCH ALL → serve frontend ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── ERROR HANDLER ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`\n✅ FinTrack Pro running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}\n`);
});

module.exports = app;
