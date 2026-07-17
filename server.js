const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = 'Ccc@0412';
let esp32IP = '';

app.get('/', (req, res) => {
  res.json({
    status: 'running',
    esp32IP: esp32IP || 'not connected',
    message: 'UNIKO Claw Machine Live!'
  });
});

app.get('/webhook', (req, res) => {
  res.json({ status: 'webhook ok' });
});

app.post('/register', (req, res) => {
  esp32IP = req.body.ip;
  console.log('ESP32 IP:', esp32IP);
  res.json({ status: 'registered' });
});

app.post('/webhook', express.raw({type: '*/*'}), (req, res) => {
  console.log('Webhook received!');

  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body.toString();
    const data = JSON.parse(body);

    if (signature) {
      const expectedSig = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(body)
        .digest('hex');

      if (signature !== expectedSig) {
        console.log('Invalid signature!');
        return res.status(401).json({ error: 'Invalid' });
      }
    }

    const event = data.event;
    console.log('Event:', event);

    if (event === 'payment.captured') {
      const amount = data.payload.payment.entity.amount / 100;
      console.log('Payment Rs.' + amount);

      if (esp32IP) {
        axios.get('http://' + esp32IP + '/trigger?amount=' + amount)
          .then(() => console.log('ESP32 triggered!'))
          .catch(err => console.log('ESP32 error:', err.message));
      }
    }

    if (event === 'payment_link.paid') {
      const amount = data.payload.payment_link.entity.amount / 100;
      console.log('Link Payment Rs.' + amount);

      if (esp32IP) {
        axios.get('http://' + esp32IP + '/trigger?amount=' + amount)
          .then(() => console.log('ESP32 triggered!'))
          .catch(err => console.log('ESP32 error:', err.message));
      }
    }

  } catch (err) {
    console.log('Error:', err.message);
  }

  res.status(200).json({ status: 'ok' });
});

app.get('/trigger', (req, res) => {
  const amount = parseInt(req.query.amount) || 10;
  console.log('Trigger Rs.' + amount);

  if (esp32IP) {
    axios.get('http://' + esp32IP + '/trigger?amount=' + amount)
      .then(() => console.log('ESP32 triggered!'))
      .catch(err => console.log('ESP32 error:', err.message));
  }

  res.json({
    status: 'triggered',
    amount: amount,
    plays: Math.floor(amount / 10),
    pulses: Math.floor(amount / 10) * 2
  });
});

app.post('/create-order', (req, res) => {
  const amount = req.body.amount || 10;
  res.json({
    orderId: 'CLAW_' + Date.now(),
    amount: amount,
    paymentLink: 'https://razorpay.me/@uniko?amount=' + (amount * 100)
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running port ' + PORT);
});