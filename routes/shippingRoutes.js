const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const shipping = require('../controllers/shippingController');

// Rates (public during checkout but behind server)
router.post('/rates', protect, shipping.getCourierRates);

// Create shipment for an order (seller/admin only)
router.post('/shipments', protect, authorize('seller', 'admin'), shipping.createShipmentForOrder);

// Schedule pickup (vendor/admin)
router.post('/pickups', protect, authorize('seller', 'admin'), shipping.schedulePickup);

// Label
router.get('/label/:id', protect, shipping.getLabelForOrder);

// Cancel shipment
router.post('/cancel/:id', protect, authorize('seller', 'admin'), shipping.cancelShipmentForOrder);

// NDR action
router.post('/ndr-action', protect, authorize('seller', 'admin'), shipping.ndrAction);

// Track order/shipment
router.post('/track', protect, shipping.trackOrder);

module.exports = router;


