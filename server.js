const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const app = express();

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const ORACLE_SERVER_URL = process.env.ORACLE_SERVER_URL;
const PORT = process.env.PORT || 8080;

// In-memory dedupe cache: Razorpay retries webhooks if it doesn't get a fast
// 200 response, which was causing the SAME payment to be forwarded to Oracle
// 2-3 times and firing extra relay pulses. We remember recently-seen payment
// IDs for 10 minutes and skip forwarding if we've already processed one.
const processedPayments = new Map(); // payment_id -> timestamp
const DEDUPE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function alreadyProcessed(paymentId) {
  const now = Date.now();
  for (const [id, ts] of processedPayments) {
    if (now - ts > DEDUPE_WINDOW_MS) processedPayments.delete(id);
  }
  if (processedPayments.has(paymentId)) return true;
  processedPayments.set(paymentId, now);
  return false;
}

app.get('/', (req, res) => {
  res.send('UNIKO Webhook Receiver - Running');
});

app.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.log('Webhook signature mismatch - rejecting');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body.event;
    console.log('Received Razorpay event:', event);

    // Real QR Code payments - most reliable routing, uses the QR's own ID
    // Real QR Code payments - the ONLY event we process for QR payments.
    // (Razorpay also sends a generic "payment.captured" event for the same
    // transaction - we deliberately ignore that one to avoid double-crediting.)
    if (event === 'qr_code.credited') {
      const payload = req.body.payload;
      const qrCode = payload.qr_code ? payload.qr_code.entity : null;
      const payment = payload.payment ? payload.payment.entity : null;

      if (qrCode && payment) {
        if (alreadyProcessed(payment.id)) {
          console.log('Duplicate webhook for payment', payment.id, '- skipping (already forwarded)');
          return res.json({ status: 'ok', duplicate: true });
        }
        console.log('QR credited:', qrCode.id, '- amount:', payment.amount, 'paise, payment:', payment.id);
        await axios.post(`${ORACLE_SERVER_URL}/webhook-qr-payment`, {
          qr_code_id: qrCode.id,
          amount: payment.amount,
          payment_id: payment.id
        });
      }
    }

    // payment.captured / payment_link.paid: only used for OLDER machines still
    // on Payment Links (not real QR codes). Skipped entirely if it's actually
    // a QR code payment, to prevent double-crediting the same transaction.
    else if (event === 'payment_link.paid') {
      const payload = req.body.payload;
      const payment = payload.payment ? payload.payment.entity : null;

      if (payment && payment.status === 'captured') {
        if (alreadyProcessed(payment.id)) {
          console.log('Duplicate webhook for payment', payment.id, '- skipping (already forwarded)');
          return res.json({ status: 'ok', duplicate: true });
        }
        const notes = payment.notes || {};
        const machineId = notes['Machine ID'] || notes['machine_id'] ||
                           notes['MachineID'] || notes['machine id'] || null;

        console.log('Forwarding captured payment:', payment.amount, 'paise, machine:', machineId || 'unknown, payment:', payment.id);
        await axios.post(`${ORACLE_SERVER_URL}/webhook-payment`, {
          amount: payment.amount,
          machine_id: machineId,
          payment_id: payment.id
        });
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Webhook receiver running on port ' + PORT);
});
