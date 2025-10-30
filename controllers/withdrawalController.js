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
  const sellerId = req.user._id; // This is the User id for the seller

  // Validate seller exists
  const sellerUser = await User.findById(sellerId);
  if (!sellerUser) {
    return res.status(404).json({ message: 'Seller not found' });
  }

  // Compute available balance from Orders minus processed Withdrawals
  // Find Seller document to get Seller _id for Orders
  const SellerModel = require('../models/Seller');
  const OrderModel = require('../models/Order');
  const sellerDoc = await SellerModel.findOne({ userId: sellerId });
  if (!sellerDoc) {
    return res.status(404).json({ message: 'Seller profile not found' });
  }

  // Earnings rules match sellerController.getWalletOverview
  const [onlineEarningsAgg, codEarningsAgg] = await Promise.all([
    OrderModel.aggregate([
      { $match: { seller: sellerDoc._id, paymentMethod: { $ne: 'cod' }, paymentStatus: 'paid' } },
      { $project: { sellerEarnEff: { $cond: [ { $gt: ['$sellerEarnings', 0] }, '$sellerEarnings', { $subtract: ['$itemsPrice', { $multiply: ['$itemsPrice', 0.07] }] } ] } } },
      { $group: { _id: null, total: { $sum: '$sellerEarnEff' } } }
    ]),
    OrderModel.aggregate([
      { $match: { seller: sellerDoc._id, paymentMethod: 'cod', orderStatus: 'delivered' } },
      { $project: { sellerEarnEff: { $cond: [ { $gt: ['$sellerEarnings', 0] }, '$sellerEarnings', { $subtract: ['$itemsPrice', { $multiply: ['$itemsPrice', 0.07] }] } ] } } },
      { $group: { _id: null, total: { $sum: '$sellerEarnEff' } } }
    ])
  ]);

  const totalEarnings = (onlineEarningsAgg[0]?.total || 0) + (codEarningsAgg[0]?.total || 0);
  const processedWithdrawalsAgg = await Withdrawal.aggregate([
    { $match: { seller: sellerId, status: 'processed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const withdrawnAmount = processedWithdrawalsAgg[0]?.total || 0;
  const availableBalance = Math.max(0, totalEarnings - withdrawnAmount);

  if (Number(amount) > availableBalance) {
    return res.status(400).json({
      message: 'Insufficient wallet balance',
      currentBalance: availableBalance,
      requestedAmount: Number(amount)
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

  // If Razorpay credentials are not configured, fall back to creating a pending request without Razorpay IDs (dev mode)
  let hasRazorpayKeys = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_ACCOUNT_NUMBER);

  try {
    let contact = null;
    let fundAccount = null;
    if (hasRazorpayKeys) {
      try {
        // Create Razorpay Contact
        contact = await createContact(
          sellerUser.name,
          sellerUser.email,
          sellerUser.phone || '9999999999'
        );

        // Create Razorpay Fund Account
        fundAccount = await createFundAccount(
          contact.id,
          paymentMethod,
          paymentDetails
        );
      } catch (e) {
        // Fall back to non-Razorpay flow in development or when keys are misconfigured
        console.error('Razorpay setup failed, falling back to manual request creation:', e.message);
        hasRazorpayKeys = false;
      }
    }

    // Create withdrawal request; include Razorpay IDs when available
    const withdrawal = await Withdrawal.create({
      seller: sellerId,
      amount: Number(amount),
      paymentMethod,
      paymentDetails: {
        ...paymentDetails,
        ...(hasRazorpayKeys && contact ? { razorpayContactId: contact.id } : {}),
        ...(hasRazorpayKeys && fundAccount ? { razorpayFundAccountId: fundAccount.id } : {})
      },
      requestDate: new Date()
    });

    return res.status(201).json({
      success: true,
      data: withdrawal,
      message: hasRazorpayKeys
        ? 'Withdrawal request created successfully'
        : 'Withdrawal request created (Razorpay not configured: pending manual processing)'
    });
  } catch (error) {
    console.error('Withdrawal request creation error:', error);
    return res.status(500).json({
      message: 'Failed to create withdrawal request',
      error: error.message
    });
  }
});

// @desc    Get seller's own withdrawal requests
// @route   GET /api/withdrawals/mine
// @access  Private (Seller only)
exports.getSellerWithdrawalRequests = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;
  const { page = 1, limit = 10 } = req.query;

  const query = { seller: sellerId };

  const withdrawals = await Withdrawal.find(query)
    .sort({ requestDate: -1 })
    .limit(Number(limit))
    .skip((Number(page) - 1) * Number(limit));

  const total = await Withdrawal.countDocuments(query);

  res.status(200).json({
    success: true,
    data: withdrawals,
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      totalItems: total,
      itemsPerPage: Number(limit)
    }
  });
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

    const orConds = [ { seller: { $in: sellerIds } } ];

    // Match by Withdrawal ObjectId when valid
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(search)) {
      orConds.push({ _id: new mongoose.Types.ObjectId(search) });
    }
    // Also try transactionId/notes match
    orConds.push({ transactionId: { $regex: search, $options: 'i' } });
    orConds.push({ notes: { $regex: search, $options: 'i' } });

    query.$or = orConds;
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
  } else if (status === 'processing') {
    // No payout yet, just mark as in-progress by admin
    withdrawal.approvedBy = withdrawal.approvedBy || adminId;
    withdrawal.approvedDate = withdrawal.approvedDate || new Date();
  } else if (status === 'processed' || status === 'paid') {
    try {
      const hasKeys = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_ACCOUNT_NUMBER);
      let payout = null;
      if (hasKeys && withdrawal.paymentDetails?.razorpayFundAccountId) {
        // Create Razorpay Payout when configured
        payout = await createPayout(
          withdrawal.paymentDetails.razorpayFundAccountId,
          withdrawal.amount
        );
        withdrawal.razorpayPayoutId = payout.id;
        withdrawal.razorpayStatus = payout.status;
      } else {
        // Manual processing path: allow admin to enter transactionId and mark processed
        withdrawal.razorpayStatus = 'manual';
      }

      withdrawal.processedBy = adminId;
      withdrawal.processedDate = new Date();
      withdrawal.transactionId = transactionId || payout?.id || `manual_${Date.now()}`;
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
  // "Processed" dashboard count should include only requests in progress or marked processed by admin,
  // but NOT paid and NOT rejected
  const processedRequests = await Withdrawal.countDocuments({ $or: [ { status: 'processing' }, { status: 'processed' } ] });
  const rejectedRequests = await Withdrawal.countDocuments({ status: 'rejected' });

  // Calculate total amounts
  const totalWithdrawalAmount = await Withdrawal.aggregate([
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const pendingAmount = await Withdrawal.aggregate([
    { $match: { status: 'pending' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  // Amount actually paid out
  const processedAmount = await Withdrawal.aggregate([
    { $match: { status: 'paid' } },
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

// @desc    Delete a withdrawal (admin)
// @route   DELETE /api/withdrawals/admin/:id
// @access  Private (Admin only)
exports.adminDeleteWithdrawal = asyncHandler(async (req, res) => {
  const withdrawal = await Withdrawal.findById(req.params.id);
  if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found' });
  await Withdrawal.deleteOne({ _id: withdrawal._id });
  res.status(200).json({ success: true, message: 'Withdrawal deleted' });
});

// @desc    Delete seller's own withdrawal request
// @route   DELETE /api/withdrawals/:id
// @access  Private (Seller only)
exports.deleteMyWithdrawal = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;
  const withdrawal = await Withdrawal.findOne({ _id: req.params.id, seller: sellerId });
  if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found' });
  await Withdrawal.deleteOne({ _id: withdrawal._id });
  res.status(200).json({ success: true, message: 'Withdrawal deleted' });
});
