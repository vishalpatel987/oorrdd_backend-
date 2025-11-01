const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const contactController = require('../controllers/contactController');

// Public route - anyone can submit contact form
router.post('/', contactController.createContact);

// Admin routes - protected
router.get('/admin', protect, authorize('admin'), contactController.getAllContacts);
router.get('/admin/:id', protect, authorize('admin'), contactController.getContact);
router.put('/admin/:id/status', protect, authorize('admin'), contactController.updateContactStatus);
router.post('/admin/:id/reply', protect, authorize('admin'), contactController.replyToContact);

module.exports = router;

