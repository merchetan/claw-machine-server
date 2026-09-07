const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const ORACLE_SERVER_URL = process.env.ORACLE_SERVER_URL || 'http://92.4.73.103:3000';
const PORT = process.env.PORT || 8080;

app.post('/webhook', async (req, res) => {
  const event = req.body.event;

  // We only process qr_code.credited - NOT payment.captured, since that
  // would double-credit the same payment (both events fire for the same
  // transaction).
  if (event !== 'qr_code.credited') {
    return res.status(200).json({ status: 'ignored', reason: 'not a qr_code.credited event' });
  }

  try {
    const payload = req.body.payload;
    const qrCodeId = payload.qr_code.entity.id;
    const amountPaise = payload.payment.entity.amount;

    // Razorpay's payment entity includes its own unique payment ID here -
    // this is the exact reference needed to look up or refund this specific
    // payment later, e.g. "pay_XXXXXXXXXXXXX".
    const razorpayPaymentId = payload.payment.entity.id;

    console.log(`Received qr_code.credited: QR=${qrCodeId}, amount=${amountPaise}, payment_id=${razorpayPaymentId}`);

    // Retry logic: attempt delivery to Oracle up to 3 times with increasing
    // gaps, in case of a transient network blip - a lost webhook means a
    // real customer's payment never gets recorded at all.
    const delays = [2000, 4000, 6000];
    let delivered = false;

    for (let attempt = 0; attempt < delays.length && !delivered; attempt++) {
      try {
        await axios.post(`${ORACLE_SERVER_URL}/webhook-qr-payment`, {
          qr_code_id: qrCodeId,
          amount: amountPaise,
          payment_id: razorpayPaymentId
        }, { timeout: 5000 });
        delivered = true;
        console.log(`Delivered to Oracle successfully (attempt ${attempt + 1}).`);
      } catch (err) {
        console.error(`Delivery attempt ${attempt + 1} failed:`, err.message);
        if (attempt < delays.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        }
      }
    }

    if (!delivered) {
      console.error(`FAILED to deliver payment to Oracle after ${delays.length} attempts: QR=${qrCodeId}, payment_id=${razorpayPaymentId}`);
      // Still return 200 to Razorpay so it doesn't retry the webhook itself
      // (that could cause duplicate processing on our side) - the payment
      // reference is logged above for manual recovery if needed.
    }

    res.status(200).json({ status: delivered ? 'delivered' : 'logged_but_not_delivered' });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    res.status(200).json({ status: 'error', error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'UNIKO webhook receiver running' });
});

app.listen(PORT, () => {
  console.log(`Webhook receiver listening on port ${PORT}`);
});
