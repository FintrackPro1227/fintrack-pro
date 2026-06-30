// backend/routes/tax.js
const router = require('express').Router();
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

router.get('/summary', authenticate, async (req, res) => {
  try {
    const { companyId, period } = req.query;
    const startDate = period ? new Date(period + '-01') : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);

    const [salesTx, purchaseTx, payrollTx] = await Promise.all([
      prisma.transaction.findMany({ where: { companyId, type: 'SALES', date: { gte: startDate, lte: endDate }, status: 'POSTED', taxType: 'PPN_11' } }),
      prisma.transaction.findMany({ where: { companyId, type: { in: ['PURCHASE', 'EXPENSE'] }, date: { gte: startDate, lte: endDate }, status: 'POSTED', taxType: 'PPN_11' } }),
      prisma.transaction.findMany({ where: { companyId, type: 'PAYROLL', date: { gte: startDate, lte: endDate }, status: 'POSTED', taxType: 'PPH_21' } }),
    ]);

    const ppnOut = salesTx.reduce((s, t) => s + parseFloat(t.taxAmount), 0);
    const ppnIn = purchaseTx.reduce((s, t) => s + parseFloat(t.taxAmount), 0);
    const pph21 = payrollTx.reduce((s, t) => s + parseFloat(t.taxAmount), 0);

    res.json({
      period: startDate.toISOString().slice(0, 7),
      ppnOutput: ppnOut, ppnInput: ppnIn, ppnNet: ppnOut - ppnIn,
      pph21, salesTransactions: salesTx, purchaseTransactions: purchaseTx
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
