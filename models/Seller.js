const mongoose = require('mongoose');

const sellerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  shopName: {
    type: String,
    required: [true, 'Please provide a shop name'],
    trim: true,
    maxlength: [100, 'Shop name cannot be more than 100 characters']
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  logo: {
    type: String,
    default: ''
  },
  banner: {
    type: String,
    default: ''
  },
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: {
      type: String,
      default: 'India'
    }
  },
  phone: {
    type: String,
    required: [true, 'Please provide a phone number']
  },
  email: {
    type: String,
    required: [true, 'Please provide an email']
  },
  website: {
    type: String,
    default: ''
  },
  socialMedia: {
    facebook: String,
    twitter: String,
    instagram: String,
    linkedin: String
  },
  businessInfo: {
    businessType: {
      type: String,
      enum: ['individual', 'corporation', 'partnership', 'llc'],
      default: 'individual'
    },
    taxId: String,
    businessLicense: String
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  approvalDate: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectionReason: String,
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectionDate: Date,
  isSuspended: {
    type: Boolean,
    default: false
  },
  suspensionReason: String,
  suspensionDate: Date,
  suspendedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  payoutDetails: {
    accountType: {
      type: String,
      enum: ['bank', 'paypal', 'stripe'],
      default: 'bank'
    },
    accountNumber: String,
    routingNumber: String,
    accountHolderName: String,
    paypalEmail: String,
    stripeAccountId: String
  },
  commissionRate: {
    type: Number,
    default: 7, // 7% commission by default
    min: 0,
    max: 100
  },
  totalSales: {
    type: Number,
    default: 0
  },
  totalOrders: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  numReviews: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  documents: [{
    name: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true
    },
    type: {
      type: String,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Index for better query performance
sellerSchema.index({ userId: 1 });
sellerSchema.index({ isApproved: 1 });
sellerSchema.index({ shopName: 'text' });

// Virtual for average rating
sellerSchema.virtual('averageRating').get(function() {
  return this.numReviews > 0 ? this.rating / this.numReviews : 0;
});

// Ensure virtual fields are serialized
sellerSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Seller', sellerSchema); 