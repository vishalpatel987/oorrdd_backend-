const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a brand name'],
    trim: true,
    unique: true,
    maxlength: [100, 'Brand name cannot exceed 100 characters']
  },
  logo: {
    type: String,
    required: [true, 'Brand logo is required']
  },
  logoUrl: {
    type: String, // Alternative field name for compatibility
  },
  category: {
    type: String,
    enum: ['Electronics', 'Fashion', 'Books', 'Home', 'Sports', 'Beauty', 'Automotive', 'Food', 'Jewelry', 'Pets', 'Other'],
    default: 'Other'
  },
  categories: [{
    type: String,
    enum: ['Electronics', 'Fashion', 'Books', 'Home', 'Sports', 'Beauty', 'Automotive', 'Food', 'Jewelry', 'Pets', 'Other']
  }],
  website: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for better query performance
brandSchema.index({ name: 1 });
brandSchema.index({ category: 1 });
brandSchema.index({ isActive: 1, sortOrder: 1 });

// Ensure logoUrl is set from logo
brandSchema.pre('save', function(next) {
  if (this.logo && !this.logoUrl) {
    this.logoUrl = this.logo;
  }
  if (this.logoUrl && !this.logo) {
    this.logo = this.logoUrl;
  }
  next();
});

module.exports = mongoose.model('Brand', brandSchema);
