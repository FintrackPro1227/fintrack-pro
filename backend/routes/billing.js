// backend/routes/billing.js
const router = require('express').Router();
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

const PLAN_PRICE = { STARTER: 499000, BISNIS: 1299000, PRO: 2199000, ENTERPRISE: 3799000, CUSTOM: 0 };

router.get('/', authenticate, operatorOnly, async (req, res) => {
  try {
    const invoices = await prisma.clientInvoice.findMany({
      include: { client: { include: { company: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' }, take: 100
    });
    res.json(invoices);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST generate monthly invoices for all active clients
router.post('/generate-monthly', authenticate, operatorOnly, async (req, res) => {
  try {
    const { period } = req.body; // "Juli 2026"
    const clients = await prisma.client.findMany({ where: { status: 'ACTIVE' } });
    const created = [];
    const dueDate = new Date();
    dueDate.setDate(5);
    for (const client of clients) {
      const amount = PLAN_PRICE[client.plan] || PLAN_PRICE.BISNIS;
      const inv = await prisma.clientInvoice.create({
        data: { clientId: client.id, period, amount, status: 'UNPAID', dueDate }
      });
      created.push(inv);
    }
    res.json({ generated: created.length, message: `${created.length} invoice bulan ${period} dibuat.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT mark invoice as paid
router.put('/:id/pay', authenticate, operatorOnly, async (req, res) => {
  try {
    const { payMethod } = req.body;
    const inv = await prisma.clientInvoice.update({
      where: { id: req.params.id },
      data: { status: 'PAID', paidAt: new Date(), payMethod }
    });
    res.json({ invoice: inv, message: 'Pembayaran dikonfirmasi.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
