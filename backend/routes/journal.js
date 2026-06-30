// backend/routes/journal.js
const router = require('express').Router();
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { companyId, limit = 100 } = req.query;
    const entries = await prisma.journalEntry.findMany({
      where: { companyId },
      orderBy: { date: 'desc' }, take: parseInt(limit),
      include: { lines: true }
    });
    res.json(entries);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/approve', authenticate, operatorOnly, async (req, res) => {
  try {
    const entry = await prisma.journalEntry.update({
      where: { id: req.params.id },
      data: { isPosted: true, postedAt: new Date(), postedBy: req.user.id }
    });
    res.json({ message: 'Jurnal diapprove.', entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
