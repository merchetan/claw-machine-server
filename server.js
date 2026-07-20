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
const PORT = process.env.PORT || 3000;

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

    if (event === 'payment.captured' || event === 'payment_link.paid') {
      const payload = req.body.payload;
      const payment = payload.payment ? payload.payment.entity : null;

      if (payment && payment.status === 'captured') {
        const notes = payment.notes || {};
        // Try several possible key names, since we're not 100% sure
        // which exact key Razorpay uses for the custom field
        const machineId = notes['Machine ID'] || notes['machine_id'] ||
                           notes['MachineID'] || notes['machine id'] || null;

        console.log('Forwarding captured payment:', payment.amount, 'paise, machine:', machineId || 'unknown');
        await axios.post(`${ORACLE_SERVER_URL}/webhook-payment`, {
          amount: payment.amount,
          machine_id: machineId
        });
      } else {
        console.log('Payment not captured yet - skipping');
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
