// backend/routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { generateToken, authenticate } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi.' });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(401).json({ error: 'Email atau password salah.' });
    if (!user.isActive) return res.status(401).json({ error: 'Akun tidak aktif. Hubungi admin.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Email atau password salah.' });

    const token = generateToken(user.id);
    req.session.token = token;

    // Get client info if CLIENT role
    let clientData = null;
    if (user.role === 'CLIENT') {
      clientData = await prisma.client.findUnique({
        where: { userId: user.id },
        include: { company: true }
      });
    }

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      client: clientData,
      redirectTo: user.role === 'CLIENT' ? '/portal' : '/operator'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Berhasil logout.' });
});

// GET /api/auth/me — get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, role: true }
    });
    let clientData = null;
    if (user.role === 'CLIENT') {
      clientData = await prisma.client.findUnique({
        where: { userId: user.id },
        include: { company: { select: { id: true, name: true, npwp: true } } }
      });
    }
    res.json({ user, client: clientData });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(400).json({ error: 'Password lama salah.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password minimal 8 karakter.' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: req.user.id }, data: { password: hashed } });
    res.json({ message: 'Password berhasil diubah.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
