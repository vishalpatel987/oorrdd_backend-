const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true,
  },
  amount: {
    type: Number,
    required: [true, 'Withdrawal amount is required'],
    min: [1, 'Amount must be at least 1'],
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'processed'],
    default: 'pending',
  },
  paymentMethod: {
    type: String,
    required: [true, 'Payment method is required'],
    enum: ['razorpay_bank', 'razorpay_upi', 'razorpay_wallet'],
  },
  paymentDetails: {
    // For Razorpay Bank Transfer
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    accountHolderName: String,
    
    // For Razorpay UPI
    upiId: String,
    
    // For Razorpay Wallet
    walletType: String, // paytm, phonepe, etc.
    walletId: String,
    
    // Razorpay specific
    razorpayContactId: String,
    razorpayFundAccountId: String,
  },
  requestDate: {
    type: Date,
    default: Date.now,
  },
  approvedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
  },
  approvedDate: Date,
  processedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
  },
  processedDate: Date,
  transactionId: String,
  razorpayPayoutId: String,
  razorpayStatus: String,
  notes: String,
}, {
  timestamps: true,
});

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
