// backend/routes/purchasing.js — Suppliers & Purchase Orders (ERP: Pembelian)
const router = require('express').Router();
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

// ── SUPPLIERS ──
router.get('/suppliers', authenticate, async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: { companyId: req.query.companyId },
      orderBy: { name: 'asc' }
    });
    res.json(suppliers);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/suppliers', authenticate, operatorOnly, async (req, res) => {
  try {
    const { companyId, code, name, contactPerson, phone, email, address, npwp } = req.body;
    const supplier = await prisma.supplier.create({
      data: { companyId, code, name, contactPerson, phone, email, address, npwp }
    });
    res.json(supplier);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PURCHASE ORDERS ──
router.get('/orders', authenticate, async (req, res) => {
  try {
    const { companyId, status } = req.query;
    const where = { companyId };
    if (status) where.status = status;
    const orders = await prisma.purchaseOrder.findMany({
      where, orderBy: { date: 'desc' },
      include: { supplier: true, items: { include: { product: true } }, transaction: { select: { id: true, journalEntry: true } } }
    });
    res.json(orders);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/orders/:id', authenticate, async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { supplier: true, items: { include: { product: true } }, transaction: { include: { journalEntry: { include: { lines: true } } } } }
    });
    if (!order) return res.status(404).json({ error: 'Purchase order tidak ditemukan.' });
    res.json(order);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/orders', authenticate, operatorOnly, async (req, res) => {
  try {
    const { companyId, supplierId, date, expectedDate, notes, items, taxType } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'Purchase order harus punya minimal 1 item.' });

    const subtotal = items.reduce((s, i) => s + parseFloat(i.qty) * parseFloat(i.unitPrice), 0);
    const taxAmount = taxType === 'PPN_11' ? Math.round(subtotal * 0.11) : 0;
    const total = subtotal + taxAmount;

    const count = await prisma.purchaseOrder.count({ where: { companyId } });
    const poNumber = `PO-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(count + 1).padStart(4, '0')}`;

    const order = await prisma.purchaseOrder.create({
      data: {
        companyId, poNumber, supplierId, date: new Date(date), expectedDate: expectedDate ? new Date(expectedDate) : null,
        notes, subtotal, taxAmount, total, status: 'DRAFT',
        items: { create: items.map(i => ({ productId: i.productId, qty: parseFloat(i.qty), unitPrice: parseFloat(i.unitPrice), amount: parseFloat(i.qty) * parseFloat(i.unitPrice) })) }
      },
      include: { items: true, supplier: true }
    });
    res.json(order);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/orders/:id/order', authenticate, operatorOnly, async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: 'Purchase order tidak ditemukan.' });
    if (order.status !== 'DRAFT') return res.status(400).json({ error: 'Hanya PO berstatus draft yang bisa dikirim ke supplier.' });
    const updated = await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: 'ORDERED' } });
    res.json({ message: 'Purchase order dikirim ke supplier.', order: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Receive: increment stock, update avg purchase price, post AP journal
router.post('/orders/:id/receive', authenticate, operatorOnly, async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { product: true } }, supplier: true }
    });
    if (!order) return res.status(404).json({ error: 'Purchase order tidak ditemukan.' });
    if (order.status !== 'ORDERED') return res.status(400).json({ error: 'Hanya PO berstatus ordered yang bisa diterima.' });

    const result = await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const qty = parseFloat(item.qty);
        const newBalance = parseFloat(item.product.stockQty) + qty;
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: newBalance, purchasePrice: parseFloat(item.unitPrice) }
        });
        await tx.stockMovement.create({
          data: {
            companyId: order.companyId, productId: item.productId, type: 'IN', qty,
            refType: 'PO', refId: order.poNumber, balanceAfter: newBalance
          }
        });
      }

      const getAcc = (code) => tx.account.findFirst({ where: { companyId: order.companyId, code } });
      const ap = await getAcc('2100');
      const inv = await getAcc('1400');
      const ppnIn = await getAcc('1300');

      const lines = [];
      const subtotal = parseFloat(order.subtotal);
      const taxAmt = parseFloat(order.taxAmount);
      const total = parseFloat(order.total);
      if (inv) lines.push({ accountId: inv.id, accountCode: inv.code, accountName: inv.name, debit: subtotal, credit: 0, description: 'Penerimaan persediaan — ' + order.poNumber });
      if (ppnIn && taxAmt > 0) lines.push({ accountId: ppnIn.id, accountCode: ppnIn.code, accountName: ppnIn.name, debit: taxAmt, credit: 0, description: 'PPN Masukan' });
      if (ap) lines.push({ accountId: ap.id, accountCode: ap.code, accountName: ap.name, debit: 0, credit: total, description: order.supplier.name });

      const transaction = await tx.transaction.create({
        data: {
          companyId: order.companyId, refNumber: order.poNumber, date: order.date, type: 'PURCHASE',
          party: order.supplier.name, partyNpwp: order.supplier.npwp, description: 'Purchase order ' + order.poNumber,
          dpp: subtotal, taxType: taxAmt > 0 ? 'PPN_11' : 'NONE', taxAmount: taxAmt, total, status: 'DRAFT', sourceType: 'MANUAL',
          items: { create: order.items.map(i => ({ name: i.product.name, qty: parseFloat(i.qty), unitPrice: parseFloat(i.unitPrice), amount: parseFloat(i.amount) })) }
        }
      });

      let journal = null;
      if (lines.length) {
        journal = await tx.journalEntry.create({
          data: {
            companyId: order.companyId, refNumber: 'JE-' + order.poNumber, date: order.date,
            description: `Pembelian — ${order.supplier.name} — ${order.poNumber}`,
            source: 'MANUAL', isPosted: false, transactionId: transaction.id,
            lines: { create: lines }
          },
          include: { lines: true }
        });
      }

      const updatedOrder = await tx.purchaseOrder.update({
        where: { id: order.id }, data: { status: 'RECEIVED', transactionId: transaction.id }
      });

      return { order: updatedOrder, transaction, journal };
    });

    res.json({ message: 'Barang diterima, stok & jurnal terupdate.', ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/orders/:id/cancel', authenticate, operatorOnly, async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: 'Purchase order tidak ditemukan.' });
    if (order.status === 'RECEIVED') return res.status(400).json({ error: 'PO yang sudah diterima tidak bisa dibatalkan.' });
    const updated = await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    res.json({ message: 'Purchase order dibatalkan.', order: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
