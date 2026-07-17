const express = require('express');
const crypto = require('crypto');
const app = express();

const WEBHOOK_SECRET = 'Ccc@0412';
let esp32IP = '';
let pendingPayments = [];

// Must use raw body for webhook!
app.use((req, res, next) => {
  if (req.path === '/webhook') {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      req.rawBody = data;
      try {
        req.body = JSON.parse(data);
      } catch(e) {
        req.body = {};
      }
      next();
    });
  } else {
    express.json()(req, res, next);
  }
});

app.get('/', (req, res) => {
  res.json({
    status:  'running',
    version: '3.0',
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
  console.log('Check payment called! Pending: ' + pendingPayments.length);
  if (pendingPayments.length > 0) {
    const payment = pendingPayments.shift();
    console.log('Sending to ESP32: Rs.' + payment.amount);
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
  console.log('Body:', JSON.stringify(req.body));

  try {
    // Verify signature
    const signature = req.headers['x-razorpay-signature'];
    if (signature && req.rawBody) {
      const expectedSig = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(req.rawBody)
        .digest('hex');
      console.log('Expected:', expectedSig);
      console.log('Received:', signature);
      if (signature !== expectedSig) {
        console.log('Signature mismatch! Still processing...');
      }
    }

    const event = req.body.event;
    console.log('Event:', event);

    if (event === 'payment.captured') {
      const amount = req.body.payload.payment.entity.amount / 100;
      console.log('Payment captured! Rs.' + amount);
      pendingPayments.push({ amount: amount });
      console.log('Pending now:', pendingPayments.length);
    }

    if (event === 'payment_link.paid') {
      const amount = req.body.payload.payment_link.entity.amount / 100;
      console.log('Link paid! Rs.' + amount);
      pendingPayments.push({ amount: amount });
      console.log('Pending now:', pendingPayments.length);
    }

  } catch (err) {
    console.log('Webhook error:', err.message);
  }

  res.status(200).json({ status: 'ok' });
});

app.get('/trigger', (req, res) => {
  const amount = parseInt(req.query.amount) || 10;
  console.log('Manual trigger Rs.' + amount);
  pendingPayments.push({ amount: amount });
  console.log('Pending now:', pendingPayments.length);
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
  console.log('UNIKO Server v3.0 running! Port: ' + PORT);
});
