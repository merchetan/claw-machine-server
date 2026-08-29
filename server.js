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

app.get('/', (req, res) => {
  res.send('UNIKO Webhook Receiver - Running');
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Tries to forward to the Oracle server, retrying a few times with a short
// delay if it fails - so a brief network blip doesn't silently lose a payment.
async function forwardWithRetry(url, data, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await axios.post(url, data, { timeout: 8000 });
      console.log(`Forwarded successfully to ${url} (attempt ${attempt})`);
      return true;
    } catch (err) {
      console.error(`Forward attempt ${attempt} to ${url} failed:`, err.message);
      if (attempt < maxAttempts) {
        await sleep(2000 * attempt);
      }
    }
  }
  console.error(`GAVE UP forwarding to ${url} after ${maxAttempts} attempts. Data:`, JSON.stringify(data));
  return false;
}

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

    // Real QR Code payments - the ONLY event we process for QR payments.
    // (Razorpay also sends a generic "payment.captured" event for the same
    // transaction - we deliberately ignore that one to avoid double-crediting.)
    if (event === 'qr_code.credited') {
      const payload = req.body.payload;
      const qrCode = payload.qr_code ? payload.qr_code.entity : null;
      const payment = payload.payment ? payload.payment.entity : null;

      if (qrCode && payment) {
        console.log('QR credited:', qrCode.id, '- amount:', payment.amount, 'paise, payment:', payment.id);
        await forwardWithRetry(`${ORACLE_SERVER_URL}/webhook-qr-payment`, {
          qr_code_id: qrCode.id,
          amount: payment.amount
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
        const notes = payment.notes || {};
        const machineId = notes['Machine ID'] || notes['machine_id'] ||
                           notes['MachineID'] || notes['machine id'] || null;

        console.log('Forwarding captured payment:', payment.amount, 'paise, machine:', machineId || 'unknown');
        await forwardWithRetry(`${ORACLE_SERVER_URL}/webhook-payment`, {
          amount: payment.amount,
          machine_id: machineId
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
