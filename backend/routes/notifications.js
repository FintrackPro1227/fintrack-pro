// backend/routes/notifications.js
const router = require('express').Router();
const prisma = require('../db');
const { authenticate } = require('../middleware/auth');

// GET all unread notifications for current user
router.get('/', authenticate, async (req, res) => {
  try {
    const notifs = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    const unreadCount = notifs.filter(n => !n.isRead).length;
    res.json({ notifications: notifs, unreadCount });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT mark one as read
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    res.json({ message: 'OK' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT mark all as read
router.put('/read-all', authenticate, async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true }
    });
    res.json({ message: 'Semua notifikasi dibaca.', count: result.count });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
