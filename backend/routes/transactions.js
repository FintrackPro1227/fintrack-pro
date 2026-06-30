// backend/routes/transactions.js
const router = require('express').Router();
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { companyId, type, status, startDate, endDate, limit = 50 } = req.query;
    const where = { companyId };
    if (type) where.type = type;
    if (status) where.status = status;
    if (startDate || endDate) where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);

    const txs = await prisma.transaction.findMany({
      where, orderBy: { date: 'desc' }, take: parseInt(limit),
      include: { items: true, journalEntry: { select: { id: true, isPosted: true, refNumber: true } } }
    });
    res.json(txs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, operatorOnly, async (req, res) => {
  try {
    const { companyId, refNumber, date, type, party, partyNpwp, description, dpp, taxType, taxAmount, total, items, documentId } = req.body;

    const tx = await prisma.transaction.create({
      data: {
        companyId, refNumber, date: new Date(date), type, party, partyNpwp, description,
        dpp: parseFloat(dpp), taxType: taxType || 'NONE',
        taxAmount: parseFloat(taxAmount || 0), total: parseFloat(total),
        status: 'DRAFT', sourceType: documentId ? 'SCAN' : 'MANUAL', documentId,
        items: { create: (items || []).map(i => ({ name: i.name, qty: parseFloat(i.qty), unitPrice: parseFloat(i.unitPrice), amount: parseFloat(i.amount) })) }
      },
      include: { items: true }
    });

    // Auto-create journal entry
    const journal = await autoCreateJournal(tx, companyId);
    res.json({ transaction: tx, journal });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/post', authenticate, operatorOnly, async (req, res) => {
  try {
    const tx = await prisma.transaction.update({
      where: { id: req.params.id },
      data: { status: 'POSTED' }
    });
    await prisma.journalEntry.updateMany({
      where: { transactionId: tx.id },
      data: { isPosted: true, postedAt: new Date(), postedBy: req.user.id }
    });
    res.json({ message: 'Transaksi diposting.', transaction: tx });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function autoCreateJournal(tx, companyId) {
  const getAcc = async (code) => prisma.account.findFirst({ where: { companyId, code } });

  const lines = [];
  const dpp = parseFloat(tx.dpp);
  const taxAmt = parseFloat(tx.taxAmount);
  const total = parseFloat(tx.total);

  if (tx.type === 'SALES') {
    const ar = await getAcc('1100');
    const rev = await getAcc('4000');
    const ppnOut = await getAcc('2300');
    if (ar) lines.push({ accountId: ar.id, accountCode: '1100', accountName: ar.name, debit: total, credit: 0, description: tx.party });
    if (rev) lines.push({ accountId: rev.id, accountCode: '4000', accountName: rev.name, debit: 0, credit: dpp, description: 'Pendapatan' });
    if (ppnOut && taxAmt > 0 && tx.taxType === 'PPN_11') lines.push({ accountId: ppnOut.id, accountCode: '2300', accountName: ppnOut.name, debit: 0, credit: taxAmt, description: 'PPN Keluaran' });
  } else if (tx.type === 'PURCHASE' || tx.type === 'EXPENSE') {
    const ap = await getAcc('2100');
    const exp = await getAcc('6100');
    const ppnIn = await getAcc('1300');
    if (exp) lines.push({ accountId: exp.id, accountCode: '6100', accountName: exp.name, debit: dpp, credit: 0, description: tx.description || tx.party });
    if (ppnIn && taxAmt > 0 && tx.taxType === 'PPN_11') lines.push({ accountId: ppnIn.id, accountCode: '1300', accountName: ppnIn.name, debit: taxAmt, credit: 0, description: 'PPN Masukan' });
    if (ap) lines.push({ accountId: ap.id, accountCode: '2100', accountName: ap.name, debit: 0, credit: total, description: tx.party });
  } else if (tx.type === 'PAYROLL') {
    const sal = await getAcc('5100');
    const pph = await getAcc('2400');
    const cash = await getAcc('1000');
    const pphAmt = tx.taxType === 'PPH_21' ? taxAmt : 0;
    const net = total - pphAmt;
    if (sal) lines.push({ accountId: sal.id, accountCode: '5100', accountName: sal.name, debit: total, credit: 0, description: 'Beban gaji' });
    if (pph && pphAmt > 0) lines.push({ accountId: pph.id, accountCode: '2400', accountName: pph.name, debit: 0, credit: pphAmt, description: 'PPh 21 dipotong' });
    if (cash) lines.push({ accountId: cash.id, accountCode: '1000', accountName: cash.name, debit: 0, credit: net, description: 'Gaji bersih dibayar' });
  }

  if (lines.length === 0) return null;

  return prisma.journalEntry.create({
    data: {
      companyId, refNumber: 'JE-' + tx.refNumber,
      date: tx.date, description: `${tx.type} — ${tx.party} — ${tx.refNumber}`,
      source: 'AUTO_SCAN', isPosted: false, transactionId: tx.id,
      lines: { create: lines }
    },
    include: { lines: true }
  });
}

module.exports = router;
