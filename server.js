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

    if (event === 'qr_code.credited') {
      const payload = req.body.payload;
      const qrCode = payload.qr_code ? payload.qr_code.entity : null;
      const payment = payload.payment ? payload.payment.entity : null;

      if (qrCode && payment) {
        console.log('QR credited:', qrCode.id, '- amount:', payment.amount, 'paise');
        await axios.post(`${ORACLE_SERVER_URL}/webhook-qr-payment`, {
          qr_code_id: qrCode.id,
          amount: payment.amount
        });
      }
    }

    else if (event === 'payment.captured' || event === 'payment_link.paid') {
      const payload = req.body.payload;
      const payment = payload.payment ? payload.payment.entity : null;

      if (payment && payment.status === 'captured') {
        const notes = payment.notes || {};
        const machineId = notes['Machine ID'] || notes['machine_id'] ||
                           notes['MachineID'] || notes['machine id'] || null;

        console.log('Forwarding captured payment:', payment.amount, 'paise, machine:', machineId || 'unknown');
        await axios.post(`${ORACLE_SERVER_URL}/webhook-payment`, {
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