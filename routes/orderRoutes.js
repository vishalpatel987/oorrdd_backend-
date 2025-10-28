const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const orderController = require('../controllers/orderController');

// All routes are protected
router.use(protect);

// Order creation routes
router.post('/', orderController.createOrder); // For COD orders
router.post('/with-payment', orderController.createOrderWithPayment); // For Razorpay orders

// Order management routes
router.get('/', orderController.getOrders);
router.get('/:id', orderController.getOrder);
router.put('/:id/status', orderController.updateOrderStatus);
router.put('/:id/cancel', orderController.cancelOrder);

module.exports = router; 