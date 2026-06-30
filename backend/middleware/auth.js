// backend/middleware/auth.js
const jwt = require('jsonwebtoken');
const prisma = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'fintrack-jwt-secret-2026';

// Verify JWT token
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.session?.token;
    if (!token) return res.status(401).json({ error: 'Tidak terautentikasi. Silakan login.' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, role: true, isActive: true }
    });

    if (!user || !user.isActive) return res.status(401).json({ error: 'Akun tidak aktif.' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token tidak valid.' });
  }
};

// Only operators / accountants / superadmin
const operatorOnly = (req, res, next) => {
  if (!['SUPERADMIN', 'OPERATOR', 'ACCOUNTANT'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  next();
};

// Superadmin only
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Hanya superadmin.' });
  }
  next();
};

const generateToken = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });

module.exports = { authenticate, operatorOnly, adminOnly, generateToken };
