const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const WEBHOOK_SECRET = 'Ccc@0412';
let esp32IP = '';
let pendingPayments = [];

app.get('/', (req, res) => {
  res.json({
    status:  'running',
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
  console.log('Check payment called!');
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

app.post('/webhook', express.raw({type: '*/*'}), (req, res) => {
  console.log('Webhook received!');
  try {
    const body = req.body.toString();
    const data = JSON.parse(body);
    const event = data.event;
    console.log('Event:', event);

    if (event === 'payment.captured') {
      const amount = data.payload.payment.entity.amount / 100;
      console.log('Payment! Rs.' + amount);
      pendingPayments.push({ amount: amount });
    }

    if (event === 'payment_link.paid') {
      const amount = data.payload.payment_link.entity.amount / 100;
      console.log('Link paid! Rs.' + amount);
      pendingPayments.push({ amount: amount });
    }
  } catch (err) {
    console.log('Error:', err.message);
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
  console.log('Server running! Port: ' + PORT);
});
