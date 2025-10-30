const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const adminController = require('../controllers/adminController');
const orderController = require('../controllers/orderController');

// All routes are protected and admin only
router.use(protect);
router.use(authorize('admin'));

router.get('/dashboard', adminController.getDashboard);
router.get('/users', adminController.getUsers);
router.post('/users', adminController.createUser);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);
router.put('/users/:id/block', adminController.blockUser);
router.put('/users/:id/unblock', adminController.unblockUser);
router.get('/users/:id/orders', adminController.getUserOrders);
router.get('/sellers', adminController.getSellers);
router.put('/sellers/:id/approve', adminController.approveSeller);
router.put('/sellers/:id/reject', adminController.rejectSeller);
router.put('/sellers/:id/suspend', adminController.suspendSeller);
router.put('/sellers/:id/activate', adminController.activateSeller);
router.get('/products', adminController.getProducts);
router.put('/products/:id/approve', adminController.approveProduct);
router.put('/products/:id/reject', adminController.rejectProduct);
router.post('/products/bulk-approve', adminController.bulkApproveProducts);
router.post('/products/bulk-reject', adminController.bulkRejectProducts);
router.get('/orders', adminController.getOrders);
router.get('/analytics', adminController.getAnalytics);
router.get('/orders/cancellation-requests', adminController.getCancellationRequests);
router.put('/orders/:id/approve-cancel', orderController.adminApproveCancellation);
router.put('/orders/:id/refund', orderController.adminRefundOrder);
// Reports
router.get('/reports/sales', adminController.getSalesReport);
router.get('/reports/top-products', adminController.getTopProducts);
router.get('/reports/top-vendors', adminController.getTopVendors);

// Admin earnings (commission) routes
router.get('/wallet/admin-earnings', adminController.getAdminEarningsSummary);
router.get('/wallet/admin-earnings/trend', adminController.getAdminEarningsTrend);

// Wallet Management Routes
router.get('/wallet/overview', adminController.getWalletOverview);
router.get('/wallet/seller-earnings', adminController.getSellerEarnings);
router.get('/wallet/withdrawals', adminController.getWithdrawalRequests);

module.exports = router; 
 