// backend/routes/dashboard.js
const router = require('express').Router();
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

router.get('/summary', authenticate, operatorOnly, async (req, res) => {
  try {
    const { companyId } = req.query;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalClients, pendingDocs, totalRevenue, totalExpense, recentTx] = await Promise.all([
      prisma.client.count({ where: { status: 'ACTIVE' } }),
      prisma.document.count({ where: { status: { in: ['PENDING', 'PROCESSING', 'EXTRACTED'] } } }),
      prisma.transaction.aggregate({
        where: { companyId, type: 'SALES', date: { gte: startOfMonth }, status: 'POSTED' },
        _sum: { total: true }
      }),
      prisma.transaction.aggregate({
        where: { companyId, type: { in: ['PURCHASE', 'EXPENSE', 'PAYROLL'] }, date: { gte: startOfMonth }, status: 'POSTED' },
        _sum: { total: true }
      }),
      prisma.transaction.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { journalEntry: { select: { isPosted: true } } }
      })
    ]);

    const revenue = Number(totalRevenue._sum.total || 0);
    const expense = Number(totalExpense._sum.total || 0);

    res.json({
      totalClients,
      pendingDocs,
      revenue,
      expense,
      netProfit: revenue - expense,
      recentTransactions: recentTx
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
