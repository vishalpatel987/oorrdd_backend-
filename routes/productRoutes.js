const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { protect, authorize } = require('../middleware/authMiddleware');
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Public routes
router.get('/', productController.getProducts);
router.get('/featured', productController.getFeaturedProducts);
router.get('/search', productController.searchProducts);
router.get('/category/:categoryId', productController.getProductsByCategory);

// Event banner routes (must be before /:id)
router.post('/event-banner', protect, authorize('admin'), productController.createOrUpdateEventBanner);
router.get('/event-banner', productController.getEventBanner);
router.delete('/event-banner', protect, authorize('admin'), productController.deleteEventBanner);

// Discover and recommended products
router.get('/discover', productController.getDiscoverProducts);
router.get('/recommended', productController.getRecommendedProducts);

// Get all reviews for a vendor's products (must come before /:id routes)
router.get('/vendor/:vendorId/reviews', productController.getReviewsForVendor);

// Get product by ID
router.get('/:id', productController.getProduct);

// Get product variant by combination
router.post('/:id/variant', productController.getProductVariant);

// Get all reviews for a product
router.get('/:id/reviews', productController.getReviewsForProduct);

// Protected routes (for reviews)
router.post('/:id/reviews', protect, productController.addReview);

// Update and delete review routes
router.patch('/:id/reviews', protect, productController.updateReview);
router.delete('/:id/reviews', protect, productController.deleteReview);

// Admin-only product management
router.put('/:id/approve', protect, authorize('admin'), productController.approveProduct);
router.put('/:id/reject', protect, authorize('admin'), productController.rejectProduct);
router.put('/:id', protect, authorize('admin'), productController.adminEditProduct);
router.delete('/:id', protect, authorize('admin'), productController.adminDeleteProduct);

// Admin-only: Set/unset featured product
router.patch('/:id/feature', protect, authorize('admin'), productController.setFeaturedProduct);
router.patch('/:id/unfeature', protect, authorize('admin'), productController.unsetFeaturedProduct);

// Admin-only: Set/unset event product
router.patch('/:id/event-product', protect, authorize('admin'), productController.setEventProduct);
router.patch('/:id/unevent-product', protect, authorize('admin'), productController.unsetEventProduct);

// Admin-only: Set/unset discover product
router.patch('/:id/discover', protect, authorize('admin'), productController.setDiscoverProduct);
router.patch('/:id/undiscover', protect, authorize('admin'), productController.unsetDiscoverProduct);

// Admin-only: Set/unset recommended product
router.patch('/:id/recommend', protect, authorize('admin'), productController.setRecommendedProduct);
router.patch('/:id/unrecommend', protect, authorize('admin'), productController.unsetRecommendedProduct);

// Variant management routes (Seller only)
// Add a new variant to a product
router.post('/:id/variants', protect, authorize('seller'), productController.addVariant);
// Update a variant option for a product
router.put('/:id/variants', protect, authorize('seller'), productController.updateVariantOption);
// Delete a variant option from a product
router.delete('/:id/variants', protect, authorize('seller'), productController.deleteVariantOption);
// Upload an image for a variant option (uses Multer)
router.post('/:id/variant-option-image', protect, authorize('seller'), upload.single('file'), productController.uploadVariantOptionImage);

module.exports = router; 