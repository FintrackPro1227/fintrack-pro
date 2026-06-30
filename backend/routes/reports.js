// backend/routes/reports.js
const router = require('express').Router();
const prisma = require('../db');
const { authenticate } = require('../middleware/auth');

router.get('/pl', authenticate, async (req, res) => {
  try {
    const { companyId, startDate, endDate } = req.query;
    const where = { companyId, status: 'POSTED' };
    if (startDate) where.date = { gte: new Date(startDate) };
    if (endDate) where.date = { ...where.date, lte: new Date(endDate) };

    const [revenue, cogs, salaries, office, other] = await Promise.all([
      prisma.transaction.aggregate({ where: { ...where, type: 'SALES' }, _sum: { dpp: true } }),
      prisma.transaction.aggregate({ where: { ...where, type: 'PURCHASE', party: { contains: 'HPP' } }, _sum: { dpp: true } }),
      prisma.transaction.aggregate({ where: { ...where, type: 'PAYROLL' }, _sum: { total: true } }),
      prisma.transaction.aggregate({ where: { ...where, type: 'EXPENSE' }, _sum: { dpp: true } }),
      prisma.transaction.aggregate({ where: { ...where, type: 'OTHER' }, _sum: { dpp: true } }),
    ]);

    const totalRevenue = parseFloat(revenue._sum.dpp || 0);
    const totalExpense = parseFloat(cogs._sum.dpp || 0) + parseFloat(salaries._sum.total || 0) + parseFloat(office._sum.dpp || 0) + parseFloat(other._sum.dpp || 0);

    res.json({
      revenue: totalRevenue,
      expenses: { cogs: parseFloat(cogs._sum.dpp || 0), salaries: parseFloat(salaries._sum.total || 0), office: parseFloat(office._sum.dpp || 0), other: parseFloat(other._sum.dpp || 0), total: totalExpense },
      netProfit: totalRevenue - totalExpense,
      margin: totalRevenue > 0 ? ((totalRevenue - totalExpense) / totalRevenue * 100).toFixed(1) : 0
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET list of reports sent to client
router.get('/client/:clientId', authenticate, async (req, res) => {
  try {
    const reports = await prisma.report.findMany({
      where: { clientId: req.params.clientId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(reports);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
