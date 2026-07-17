const express = require('express');
const crypto = require('crypto');
const app = express();

const WEBHOOK_SECRET = 'Ccc@0412';
let esp32IP = '';
let pendingPayments = [];

// Raw body for webhook signature
app.use('/webhook', express.raw({ type: '*/*' }));
// JSON for everything else
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status:  'running',
    version: '4.0',
    esp32IP: esp32IP || 'not connected',
    message: 'UNIKO Claw Machine Live!',
    pending: pendingPayments.length
  });
});

app.post('/register', (req, res) => {
  esp32IP = req.body.ip;
  console.log('ESP32 IP:', esp32IP);
  res.json({ status: 'registered' });
});

app.get('/check-payment', (req, res) => {
  console.log('Check payment! Pending: ' + pendingPayments.length);
  if (pendingPayments.length > 0) {
    const payment = pendingPayments.shift();
    console.log('Sending Rs.' + payment.amount);
    res.json({
      payment: true,
      amount:  payment.amount,
      plays:   Math.floor(payment.amount / 10),
      pulses:  Math.floor(payment.amount / 10) * 2
    });
  } else {
    res.json({ payment: false });
  }
});

app.get('/webhook', (req, res) => {
  res.json({ status: 'webhook ok' });
});

app.post('/webhook', (req, res) => {
  console.log('Webhook received!');

  try {
    // Parse raw body
    const rawBody = req.body.toString('utf8');
    console.log('Raw body:', rawBody.substring(0, 100));

    const data = JSON.parse(rawBody);
    const event = data.event;
    console.log('Event:', event);

    // Verify signature
    const signature = req.headers['x-razorpay-signature'];
    if (signature) {
      const expectedSig = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

      if (signature !== expectedSig) {
        console.log('Invalid signature!');
        return res.status(401).json({ error: 'Invalid' });
      }
      console.log('Signature valid!');
    }

    if (event === 'payment.captured') {
      const amount = data.payload.payment.entity.amount / 100;
      console.log('Payment! Rs.' + amount);
      pendingPayments.push({ amount: amount });
      console.log('Pending:', pendingPayments.length);
    }

    if (event === 'payment_link.paid') {
      const amount = data.payload.payment_link.entity.amount / 100;
      console.log('Link paid! Rs.' + amount);
      pendingPayments.push({ amount: amount });
      console.log('Pending:', pendingPayments.length);
    }

  } catch (err) {
    console.log('Webhook error:', err.message);
  }

  res.status(200).json({ status: 'ok' });
});

app.get('/trigger', (req, res) => {
  const amount = parseInt(req.query.amount) || 10;
  console.log('Trigger Rs.' + amount);
  pendingPayments.push({ amount: amount });
  res.json({
    status:  'triggered',
    amount:  amount,
    plays:   Math.floor(amount / 10),
    pulses:  Math.floor(amount / 10) * 2,
    pending: pendingPayments.length
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('UNIKO v4.0 running! Port: ' + PORT);
});
