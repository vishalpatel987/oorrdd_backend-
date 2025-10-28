const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const { asyncHandler } = require('../middleware/errorMiddleware');
const { 
  createContact, 
  createFundAccount, 
  createPayout, 
  getPayoutStatus,
  validateBankDetails,
  validateUpiId 
} = require('../utils/razorpayPayout');

// @desc    Create withdrawal request (for sellers)
// @route   POST /api/withdrawals/request
// @access  Private (Seller only)
exports.createWithdrawalRequest = asyncHandler(async (req, res) => {
  const { amount, paymentMethod, paymentDetails } = req.body;
  const sellerId = req.user._id;

  // Validate seller has sufficient balance
  const seller = await User.findById(sellerId);
  if (!seller) {
    return res.status(404).json({ message: 'Seller not found' });
  }

  if (seller.walletBalance < amount) {
    return res.status(400).json({ 
      message: 'Insufficient wallet balance',
      currentBalance: seller.walletBalance,
      requestedAmount: amount
    });
  }

  // Validate payment details based on payment method
  let validationResult;
  if (paymentMethod === 'razorpay_bank') {
    validationResult = await validateBankDetails(paymentDetails.accountNumber, paymentDetails.ifscCode);
  } else if (paymentMethod === 'razorpay_upi') {
    validationResult = await validateUpiId(paymentDetails.upiId);
  } else if (paymentMethod === 'razorpay_wallet') {
    // Basic validation for wallet
    if (!paymentDetails.walletType || !paymentDetails.walletId) {
      validationResult = { valid: false, error: 'Wallet type and ID are required' };
    } else {
      validationResult = { valid: true, message: 'Wallet details validated' };
    }
  }

  if (!validationResult.valid) {
    return res.status(400).json({
      message: 'Invalid payment details',
      error: validationResult.error
    });
  }

  try {
    // Create Razorpay Contact
    const contact = await createContact(
      seller.name,
      seller.email,
      seller.phone || '9999999999' // Default phone if not available
    );

    // Create Razorpay Fund Account
    const fundAccount = await createFundAccount(
      contact.id,
      paymentMethod,
      paymentDetails
    );

    // Create withdrawal request with Razorpay details
    const withdrawal = await Withdrawal.create({
      seller: sellerId,
      amount,
      paymentMethod,
      paymentDetails: {
        ...paymentDetails,
        razorpayContactId: contact.id,
        razorpayFundAccountId: fundAccount.id
      },
      requestDate: new Date()
    });

    res.status(201).json({
      success: true,
      data: withdrawal,
      message: 'Withdrawal request created successfully'
    });
  } catch (error) {
    console.error('Withdrawal request creation error:', error);
    res.status(500).json({
      message: 'Failed to create withdrawal request',
      error: error.message
    });
  }
});

// @desc    Get all withdrawal requests (for admin)
// @route   GET /api/withdrawals/admin
// @access  Private (Admin only)
exports.getAllWithdrawalRequests = asyncHandler(async (req, res) => {
  const { status, search, page = 1, limit = 10 } = req.query;
  
  let query = {};
  
  // Filter by status
  if (status && status !== 'all') {
    query.status = status;
  }
  
  // Search by seller name, email, or withdrawal ID
  if (search) {
    const sellers = await User.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    }).select('_id');
    
    const sellerIds = sellers.map(seller => seller._id);
    
    query.$or = [
      { _id: { $regex: search, $options: 'i' } },
      { seller: { $in: sellerIds } }
    ];
  }

  const withdrawals = await Withdrawal.find(query)
    .populate('seller', 'name email')
    .populate('approvedBy', 'name')
    .populate('processedBy', 'name')
    .sort({ requestDate: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Withdrawal.countDocuments(query);

  res.status(200).json({
    success: true,
    data: withdrawals,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      itemsPerPage: limit
    }
  });
});

// @desc    Get withdrawal request by ID
// @route   GET /api/withdrawals/admin/:id
// @access  Private (Admin only)
exports.getWithdrawalRequestById = asyncHandler(async (req, res) => {
  const withdrawal = await Withdrawal.findById(req.params.id)
    .populate('seller', 'name email walletBalance')
    .populate('approvedBy', 'name')
    .populate('processedBy', 'name');

  if (!withdrawal) {
    return res.status(404).json({ message: 'Withdrawal request not found' });
  }

  res.status(200).json({
    success: true,
    data: withdrawal
  });
});

// @desc    Update withdrawal status
// @route   PUT /api/withdrawals/admin/:id/status
// @access  Private (Admin only)
exports.updateWithdrawalStatus = asyncHandler(async (req, res) => {
  const { status, transactionId, notes } = req.body;
  const adminId = req.user._id;
  const withdrawalId = req.params.id;

  const withdrawal = await Withdrawal.findById(withdrawalId).populate('seller');
  
  if (!withdrawal) {
    return res.status(404).json({ message: 'Withdrawal request not found' });
  }

  // Update withdrawal status and admin info
  withdrawal.status = status;
  
  if (status === 'approved') {
    withdrawal.approvedBy = adminId;
    withdrawal.approvedDate = new Date();
  } else if (status === 'processed') {
    try {
      // Create Razorpay Payout
      const payout = await createPayout(
        withdrawal.paymentDetails.razorpayFundAccountId,
        withdrawal.amount
      );

      withdrawal.processedBy = adminId;
      withdrawal.processedDate = new Date();
      withdrawal.transactionId = transactionId || payout.id;
      withdrawal.razorpayPayoutId = payout.id;
      withdrawal.razorpayStatus = payout.status;
      
      // Deduct amount from seller's wallet balance
      await User.findByIdAndUpdate(
        withdrawal.seller._id,
        { $inc: { walletBalance: -withdrawal.amount } }
      );
    } catch (error) {
      console.error('Razorpay payout creation error:', error);
      return res.status(500).json({
        message: 'Failed to process payout',
        error: error.message
      });
    }
  }
  
  if (notes) {
    withdrawal.notes = notes;
  }

  await withdrawal.save();

  res.status(200).json({
    success: true,
    data: withdrawal,
    message: `Withdrawal ${status} successfully`
  });
});

// @desc    Get withdrawal summary for admin
// @route   GET /api/withdrawals/admin/summary
// @access  Private (Admin only)
exports.getWithdrawalSummary = asyncHandler(async (req, res) => {
  const totalRequests = await Withdrawal.countDocuments();
  const pendingRequests = await Withdrawal.countDocuments({ status: 'pending' });
  const approvedRequests = await Withdrawal.countDocuments({ status: 'approved' });
  const processedRequests = await Withdrawal.countDocuments({ status: 'processed' });
  const rejectedRequests = await Withdrawal.countDocuments({ status: 'rejected' });

  // Calculate total amounts
  const totalWithdrawalAmount = await Withdrawal.aggregate([
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const pendingAmount = await Withdrawal.aggregate([
    { $match: { status: 'pending' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const processedAmount = await Withdrawal.aggregate([
    { $match: { status: 'processed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  res.status(200).json({
    success: true,
    data: {
      totalRequests,
      pendingRequests,
      approvedRequests,
      processedRequests,
      rejectedRequests,
      totalWithdrawalAmount: totalWithdrawalAmount[0]?.total || 0,
      pendingAmount: pendingAmount[0]?.total || 0,
      processedAmount: processedAmount[0]?.total || 0
    }
  });
});

// @desc    Get seller earnings summary
// @route   GET /api/withdrawals/admin/seller-earnings
// @access  Private (Admin only)
exports.getSellerEarningsSummary = asyncHandler(async (req, res) => {
  const sellers = await User.find({ role: 'seller' })
    .select('name email walletBalance')
    .sort({ walletBalance: -1 });

  const totalSellers = sellers.length;
  const totalEarnings = sellers.reduce((sum, seller) => sum + (seller.walletBalance || 0), 0);

  // Get total withdrawals for each seller
  const sellerWithdrawals = await Withdrawal.aggregate([
    { $match: { status: 'processed' } },
    { $group: { _id: '$seller', totalWithdrawn: { $sum: '$amount' } } }
  ]);

  const sellersWithData = sellers.map(seller => {
    const withdrawal = sellerWithdrawals.find(w => w._id.toString() === seller._id.toString());
    return {
      _id: seller._id,
      name: seller.name,
      email: seller.email,
      currentBalance: seller.walletBalance || 0,
      totalWithdrawn: withdrawal?.totalWithdrawn || 0,
      totalEarnings: (seller.walletBalance || 0) + (withdrawal?.totalWithdrawn || 0)
    };
  });

  res.status(200).json({
    success: true,
    data: {
      totalSellers,
      totalEarnings,
      totalWithdrawals: sellerWithdrawals.reduce((sum, w) => sum + w.totalWithdrawn, 0),
      totalBalance: totalEarnings,
      sellers: sellersWithData
    }
  });
});

// @desc    Check Razorpay payout status
// @route   GET /api/withdrawals/admin/:id/payout-status
// @access  Private (Admin only)
exports.checkPayoutStatus = asyncHandler(async (req, res) => {
  const withdrawalId = req.params.id;

  const withdrawal = await Withdrawal.findById(withdrawalId);
  
  if (!withdrawal) {
    return res.status(404).json({ message: 'Withdrawal request not found' });
  }

  if (!withdrawal.razorpayPayoutId) {
    return res.status(400).json({ message: 'No payout ID found for this withdrawal' });
  }

  try {
    const payoutStatus = await getPayoutStatus(withdrawal.razorpayPayoutId);
    
    // Update withdrawal status based on Razorpay status
    if (payoutStatus.status !== withdrawal.razorpayStatus) {
      withdrawal.razorpayStatus = payoutStatus.status;
      await withdrawal.save();
    }

    res.status(200).json({
      success: true,
      data: {
        withdrawalId: withdrawal._id,
        razorpayPayoutId: withdrawal.razorpayPayoutId,
        status: payoutStatus.status,
        amount: payoutStatus.amount / 100, // Convert from paise to rupees
        utr: payoutStatus.utr,
        fees: payoutStatus.fees / 100,
        tax: payoutStatus.tax / 100,
        createdAt: payoutStatus.created_at,
        processedAt: payoutStatus.processed_at
      }
    });
  } catch (error) {
    console.error('Payout status check error:', error);
    res.status(500).json({
      message: 'Failed to check payout status',
      error: error.message
    });
  }
});
