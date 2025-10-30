const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const withdrawalController = require('../controllers/withdrawalController');

// Seller routes
router.post('/request', protect, authorize('seller'), withdrawalController.createWithdrawalRequest);
router.delete('/:id', protect, authorize('seller'), withdrawalController.deleteMyWithdrawal);
router.get('/mine', protect, authorize('seller'), withdrawalController.getSellerWithdrawalRequests);

// Admin routes
router.get('/admin', protect, authorize('admin'), withdrawalController.getAllWithdrawalRequests);
router.get('/admin/summary', protect, authorize('admin'), withdrawalController.getWithdrawalSummary);
router.get('/admin/seller-earnings', protect, authorize('admin'), withdrawalController.getSellerEarningsSummary);
router.get('/admin/:id', protect, authorize('admin'), withdrawalController.getWithdrawalRequestById);
router.get('/admin/:id/payout-status', protect, authorize('admin'), withdrawalController.checkPayoutStatus);
router.put('/admin/:id/status', protect, authorize('admin'), withdrawalController.updateWithdrawalStatus);
router.delete('/admin/:id', protect, authorize('admin'), withdrawalController.adminDeleteWithdrawal);

module.exports = router;
