// backend/routes/accounts.js
const router = require('express').Router();
const prisma = require('../db');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const accounts = await prisma.account.findMany({
      where: { companyId: req.query.companyId },
      orderBy: { code: 'asc' }
    });
    res.json(accounts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { companyId, code, name, type, category, normalBalance } = req.body;
    const acc = await prisma.account.create({ data: { companyId, code, name, type, category, normalBalance } });
    res.json(acc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET ledger for specific account
router.get('/ledger', authenticate, async (req, res) => {
  try {
    const { companyId, accountCode } = req.query;
    const where = { journalEntry: { companyId } };
    if (accountCode) where.accountCode = accountCode;
    const lines = await prisma.journalLine.findMany({
      where, include: { journalEntry: { select: { date: true, refNumber: true, description: true, isPosted: true } } },
      orderBy: { journalEntry: { date: 'asc' } }
    });
    res.json(lines);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
