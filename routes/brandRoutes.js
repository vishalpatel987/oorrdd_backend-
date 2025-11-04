const express = require('express');
const router = express.Router();
const brandController = require('../controllers/brandController');
const { protect, authorize } = require('../middleware/authMiddleware');
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Public routes
router.get('/', brandController.getAllBrands); // Get all active brands

// Admin routes (protected)
// IMPORTANT: Put specific routes before parameterized routes
router.get('/all', protect, authorize('admin'), brandController.getBrands); // Get all brands (including inactive)
router.post('/', protect, authorize('admin'), upload.single('logo'), brandController.createBrand); // Create brand
router.get('/:id', protect, authorize('admin'), brandController.getBrandById); // Get single brand
router.put('/:id', protect, authorize('admin'), upload.single('logo'), brandController.updateBrand); // Update brand
router.delete('/:id', protect, authorize('admin'), brandController.deleteBrand); // Delete brand

module.exports = router;
