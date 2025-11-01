const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const rc = require('../controllers/returnController');

// User
router.post('/', protect, rc.createReturnRequest);
router.get('/mine', protect, rc.getMyReturnRequests);

// Admin
router.get('/admin', protect, authorize('admin'), rc.listReturnRequests);
router.put('/admin/:id/approve', protect, authorize('admin'), rc.approveReturnRequest);
router.put('/admin/:id/reject', protect, authorize('admin'), rc.rejectReturnRequest);

// Seller
router.get('/seller', protect, authorize('seller'), rc.listReturnRequestsForSeller);

// Seller: create reverse pickup manually for an order
router.post('/seller/reverse-pickup', protect, authorize('seller'), rc.manualReversePickup);

module.exports = router;


