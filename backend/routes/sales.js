// backend/routes/sales.js — Customers & Sales Orders (ERP: Penjualan)
const router = require('express').Router();
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

// ── CUSTOMERS ──
router.get('/customers', authenticate, async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { companyId: req.query.companyId },
      orderBy: { name: 'asc' }
    });
    res.json(customers);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/customers', authenticate, operatorOnly, async (req, res) => {
  try {
    const { companyId, code, name, contactPerson, phone, email, address, npwp, creditLimit } = req.body;
    const customer = await prisma.customer.create({
      data: { companyId, code, name, contactPerson, phone, email, address, npwp, creditLimit: parseFloat(creditLimit || 0) }
    });
    res.json(customer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SALES ORDERS ──
router.get('/orders', authenticate, async (req, res) => {
  try {
    const { companyId, status } = req.query;
    const where = { companyId };
    if (status) where.status = status;
    const orders = await prisma.salesOrder.findMany({
      where, orderBy: { date: 'desc' },
      include: { customer: true, items: { include: { product: true } }, transaction: { select: { id: true, journalEntry: true } } }
    });
    res.json(orders);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/orders/:id', authenticate, async (req, res) => {
  try {
    const order = await prisma.salesOrder.findUnique({
      where: { id: req.params.id },
      include: { customer: true, items: { include: { product: true } }, transaction: { include: { journalEntry: { include: { lines: true } } } } }
    });
    if (!order) return res.status(404).json({ error: 'Sales order tidak ditemukan.' });
    res.json(order);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/orders', authenticate, operatorOnly, async (req, res) => {
  try {
    const { companyId, customerId, date, dueDate, notes, items, taxType } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'Sales order harus punya minimal 1 item.' });

    const subtotal = items.reduce((s, i) => s + parseFloat(i.qty) * parseFloat(i.unitPrice), 0);
    const taxAmount = taxType === 'PPN_11' ? Math.round(subtotal * 0.11) : 0;
    const total = subtotal + taxAmount;

    const count = await prisma.salesOrder.count({ where: { companyId } });
    const soNumber = `SO-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(count + 1).padStart(4, '0')}`;

    const order = await prisma.salesOrder.create({
      data: {
        companyId, soNumber, customerId, date: new Date(date), dueDate: dueDate ? new Date(dueDate) : null,
        notes, subtotal, taxAmount, total, status: 'DRAFT',
        items: { create: items.map(i => ({ productId: i.productId, qty: parseFloat(i.qty), unitPrice: parseFloat(i.unitPrice), amount: parseFloat(i.qty) * parseFloat(i.unitPrice) })) }
      },
      include: { items: true, customer: true }
    });
    res.json(order);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/orders/:id/confirm', authenticate, operatorOnly, async (req, res) => {
  try {
    const order = await prisma.salesOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!order) return res.status(404).json({ error: 'Sales order tidak ditemukan.' });
    if (order.status !== 'DRAFT') return res.status(400).json({ error: 'Hanya SO berstatus draft yang bisa dikonfirmasi.' });

    for (const item of order.items) {
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (product && parseFloat(product.stockQty) < parseFloat(item.qty)) {
        return res.status(400).json({ error: `Stok "${product.name}" tidak cukup (tersedia ${product.stockQty}, dibutuhkan ${item.qty}).` });
      }
    }

    const updated = await prisma.salesOrder.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } });
    res.json({ message: 'Sales order dikonfirmasi.', order: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Deliver: decrement stock, post COGS, create Transaction + Journal Entry
router.post('/orders/:id/deliver', authenticate, operatorOnly, async (req, res) => {
  try {
    const order = await prisma.salesOrder.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { product: true } }, customer: true }
    });
    if (!order) return res.status(404).json({ error: 'Sales order tidak ditemukan.' });
    if (order.status !== 'CONFIRMED') return res.status(400).json({ error: 'Hanya SO berstatus confirmed yang bisa dikirim.' });

    let cogs = 0;
    for (const item of order.items) {
      const qty = parseFloat(item.qty);
      if (parseFloat(item.product.stockQty) < qty) {
        return res.status(400).json({ error: `Stok "${item.product.name}" tidak cukup untuk pengiriman.` });
      }
      cogs += qty * parseFloat(item.product.purchasePrice);
    }

    const result = await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const qty = parseFloat(item.qty);
        const newBalance = parseFloat(item.product.stockQty) - qty;
        await tx.product.update({ where: { id: item.productId }, data: { stockQty: newBalance } });
        await tx.stockMovement.create({
          data: {
            companyId: order.companyId, productId: item.productId, type: 'OUT', qty,
            refType: 'SO', refId: order.soNumber, balanceAfter: newBalance
          }
        });
      }

      const getAcc = (code) => tx.account.findFirst({ where: { companyId: order.companyId, code } });
      const ar = await getAcc('1100');
      const rev = await getAcc('4000');
      const ppnOut = await getAcc('2300');
      const hpp = await getAcc('5000');
      const inv = await getAcc('1400');

      const lines = [];
      const subtotal = parseFloat(order.subtotal);
      const taxAmt = parseFloat(order.taxAmount);
      const total = parseFloat(order.total);
      if (ar) lines.push({ accountId: ar.id, accountCode: ar.code, accountName: ar.name, debit: total, credit: 0, description: order.customer.name });
      if (rev) lines.push({ accountId: rev.id, accountCode: rev.code, accountName: rev.name, debit: 0, credit: subtotal, description: 'Pendapatan penjualan — ' + order.soNumber });
      if (ppnOut && taxAmt > 0) lines.push({ accountId: ppnOut.id, accountCode: ppnOut.code, accountName: ppnOut.name, debit: 0, credit: taxAmt, description: 'PPN Keluaran' });
      if (cogs > 0 && hpp && inv) {
        lines.push({ accountId: hpp.id, accountCode: hpp.code, accountName: hpp.name, debit: cogs, credit: 0, description: 'HPP — ' + order.soNumber });
        lines.push({ accountId: inv.id, accountCode: inv.code, accountName: inv.name, debit: 0, credit: cogs, description: 'Pengurangan persediaan — ' + order.soNumber });
      }

      const transaction = await tx.transaction.create({
        data: {
          companyId: order.companyId, refNumber: order.soNumber, date: order.date, type: 'SALES',
          party: order.customer.name, partyNpwp: order.customer.npwp, description: 'Sales order ' + order.soNumber,
          dpp: subtotal, taxType: taxAmt > 0 ? 'PPN_11' : 'NONE', taxAmount: taxAmt, total, status: 'DRAFT', sourceType: 'MANUAL',
          items: { create: order.items.map(i => ({ name: i.product.name, qty: parseFloat(i.qty), unitPrice: parseFloat(i.unitPrice), amount: parseFloat(i.amount) })) }
        }
      });

      let journal = null;
      if (lines.length) {
        journal = await tx.journalEntry.create({
          data: {
            companyId: order.companyId, refNumber: 'JE-' + order.soNumber, date: order.date,
            description: `Penjualan — ${order.customer.name} — ${order.soNumber}`,
            source: 'MANUAL', isPosted: false, transactionId: transaction.id,
            lines: { create: lines }
          },
          include: { lines: true }
        });
      }

      const updatedOrder = await tx.salesOrder.update({
        where: { id: order.id }, data: { status: 'DELIVERED', transactionId: transaction.id }
      });

      return { order: updatedOrder, transaction, journal };
    });

    res.json({ message: 'Sales order dikirim, stok & jurnal terupdate.', ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/orders/:id/cancel', authenticate, operatorOnly, async (req, res) => {
  try {
    const order = await prisma.salesOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: 'Sales order tidak ditemukan.' });
    if (order.status === 'DELIVERED') return res.status(400).json({ error: 'SO yang sudah dikirim tidak bisa dibatalkan.' });
    const updated = await prisma.salesOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    res.json({ message: 'Sales order dibatalkan.', order: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
