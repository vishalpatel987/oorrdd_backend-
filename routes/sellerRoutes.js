const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const sellerController = require('../controllers/sellerController');
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Public routes
router.post('/register', upload.fields([
  { name: 'aadharCardFile', maxCount: 1 },
  { name: 'panCardFile', maxCount: 1 },
  { name: 'businessAddressProofFile', maxCount: 1 },
  { name: 'businessLicenseFile', maxCount: 1 },
  { name: 'taxCertificateFile', maxCount: 1 },
  { name: 'bankStatementFile', maxCount: 1 }
]), sellerController.register);

// Protected routes (seller only)
router.use(protect);
router.use(authorize('seller'));

router.get('/dashboard', sellerController.getDashboard);
router.get('/products', sellerController.getProducts);
router.post('/products', upload.array('images', 5), sellerController.createProduct);
router.put('/products/:id', upload.single('image'), sellerController.updateProduct);
router.delete('/products/:id', sellerController.deleteProduct);
router.get('/orders', sellerController.getOrders);
router.put('/orders/:id/status', sellerController.updateOrderStatus);
router.get('/stats', sellerController.getStats);
router.get('/reports/sales', sellerController.getSalesReport);
router.get('/orders/status-summary', sellerController.getOrderStatusSummary);
router.get('/wallet/overview', sellerController.getWalletOverview);
router.put('/products/:id/sold-count', sellerController.updateSoldCount);

// Reviews for seller
router.get('/reviews', sellerController.getMyReviews);
router.post('/reviews/:productId/:reviewId/reply', sellerController.replyToReview);

module.exports = router; 