// backend/routes/kasbank.js
const router = require('express').Router();
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

router.get('/accounts', authenticate, async (req, res) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { companyId: req.query.companyId, isActive: true },
      orderBy: { createdAt: 'asc' }
    });
    res.json(accounts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/accounts', authenticate, operatorOnly, async (req, res) => {
  try {
    const { companyId, name, bankName, accountNo, type, balance } = req.body;
    const acc = await prisma.bankAccount.create({
      data: { companyId, name, bankName, accountNo, type: type || 'CHECKING', balance: parseFloat(balance || 0) }
    });
    res.json(acc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/mutations', authenticate, async (req, res) => {
  try {
    const { bankAccountId, limit = 100 } = req.query;
    const mutations = await prisma.bankMutation.findMany({
      where: { bankAccountId },
      orderBy: { date: 'desc' }, take: parseInt(limit)
    });
    res.json(mutations);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST import bank mutations from AI scan
router.post('/import-mutations', authenticate, operatorOnly, async (req, res) => {
  try {
    const { bankAccountId, mutations } = req.body;
    const created = [];
    for (const m of mutations) {
      const mut = await prisma.bankMutation.create({
        data: {
          bankAccountId, date: new Date(m.date), description: m.description,
          debit: parseFloat(m.debit || 0), credit: parseFloat(m.credit || 0),
          balance: parseFloat(m.balance || 0), sourceType: 'SCAN'
        }
      });
      created.push(mut);
    }
    // Update bank account balance
    if (mutations.length > 0) {
      const lastBalance = parseFloat(mutations[mutations.length - 1].balance || 0);
      await prisma.bankAccount.update({ where: { id: bankAccountId }, data: { balance: lastBalance, lastUpdated: new Date() } });
    }
    res.json({ imported: created.length, message: `${created.length} mutasi berhasil diimport.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
