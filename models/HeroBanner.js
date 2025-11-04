const mongoose = require('mongoose');

const heroBannerSchema = new mongoose.Schema({
  title: {
    type: String,
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  imageUrl: {
    type: String,
    required: [true, 'Image URL is required']
  },
  image: {
    type: String, // Alternative field name for compatibility
  },
  buttonText: {
    type: String,
    default: 'Shop Now',
    trim: true,
    maxlength: [50, 'Button text cannot exceed 50 characters']
  },
  buttonLink: {
    type: String,
    default: '/products',
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters']
  }
}, {
  timestamps: true
});

// Index for better query performance
heroBannerSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('HeroBanner', heroBannerSchema);

