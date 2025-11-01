const mongoose = require('mongoose');

const refundDetailsSchema = new mongoose.Schema({
  mode: { type: String, enum: ['bank', 'upi', 'wallet'], required: true },
  upiId: String,
  bank: {
    accountHolderName: String,
    bankName: String,
    accountNumber: String,
    ifscCode: String
  },
  walletId: String
}, { _id: false });

const returnRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  type: { type: String, enum: ['return', 'replacement'], default: 'return' },
  reasonCategory: { type: String, enum: ['defective', 'wrong_item', 'not_as_described', 'size_issue', 'other'], required: true },
  reasonText: { type: String, default: '' },
  status: { type: String, enum: ['requested', 'approved', 'rejected', 'picked', 'completed', 'cancelled'], default: 'requested' },
  refundDetails: refundDetailsSchema,
  // Reverse shipment details (if scheduled)
  reverseShipmentId: String,
  reverseAwb: String,
  reverseTrackingUrl: String,
  pickupScheduledAt: Date,
  // Shipping charges tracking
  forwardShippingCharge: { type: Number, default: 0 }, // Forward delivery charge from original order
  returnShippingCharge: { type: Number, default: 0 }, // Return/reverse pickup charge
  // Charge allocation details
  chargeAllocation: {
    scenario: { type: String, enum: ['wrong_item', 'defective', 'not_as_described', 'size_issue_vendor_fault', 'size_issue_customer_fault', 'customer_changed_mind', 'rto_cod', 'rto_online', 'other'], default: 'other' },
    vendorCharge: { type: Number, default: 0 }, // Amount vendor pays
    adminCharge: { type: Number, default: 0 }, // Amount admin pays
    totalReturnCharge: { type: Number, default: 0 }, // Total return charge
    allocationApplied: { type: Boolean, default: false } // Whether charges have been deducted
  },
  approvedAt: Date,
  rejectedAt: Date,
  completedAt: Date
}, { timestamps: true });

returnRequestSchema.index({ user: 1, order: 1 });

module.exports = mongoose.model('ReturnRequest', returnRequestSchema);


