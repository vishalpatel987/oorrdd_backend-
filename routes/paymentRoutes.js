const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const paymentController = require('../controllers/paymentController');

// All routes are protected
router.use(protect);

// Payment routes
router.post('/create-order', paymentController.createPaymentOrder);
router.post('/verify', paymentController.verifyPayment);
router.get('/status/:paymentId', paymentController.getPaymentStatus);

module.exports = router;
