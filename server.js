const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const app = express();

// IMPORTANT: Razorpay webhook signature verification needs the RAW body,
// not JSON-parsed - so we capture it specially here.
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const ORACLE_SERVER_URL = process.env.ORACLE_SERVER_URL; // e.g. http://92.4.73.103:3000

app.get('/', (req, res) => {
  res.send('UNIKO Webhook Receiver - Running');
});

app.post('/webhook', async (req, res) => {
  try {
    // Step 1: Verify this webhook genuinely came from Razorpay
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

    // Step 2: Handle QR code payment events
    if (event === 'qr_code.credited' || event === 'payment.captured') {
      const payload = req.body.payload;
      const qrCode = payload.qr_code ? payload.qr_code.entity : null;
      const payment = payload.payment ? payload.payment.entity : null;

      // We stored our internal order_id in the QR code's "notes" field when creating it
      const notes = qrCode ? qrCode.notes : (payment ? payment.notes : null);
      const orderId = notes ? notes.order_id : null;

      if (orderId) {
        console.log('Marking order as paid:', orderId);
        await axios.post(`${ORACLE_SERVER_URL}/mark-paid`, { order_id: orderId });
      } else {
        console.log('No order_id found in webhook notes - skipping');
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Webhook receiver running');
});
