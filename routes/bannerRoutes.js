const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/bannerController');
const { protect, authorize } = require('../middleware/authMiddleware');
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Public routes
router.get('/', bannerController.getAllBanners); // Get all active banners

// Admin routes (protected)
// IMPORTANT: Put specific routes before parameterized routes
router.get('/all', protect, authorize('admin'), bannerController.getBanners); // Get all banners (including inactive)
router.post('/', protect, authorize('admin'), upload.single('image'), bannerController.createBanner); // Create banner
router.get('/:id', protect, authorize('admin'), bannerController.getBannerById); // Get single banner
router.put('/:id', protect, authorize('admin'), upload.single('image'), bannerController.updateBanner); // Update banner
router.delete('/:id', protect, authorize('admin'), bannerController.deleteBanner); // Delete banner

module.exports = router;

