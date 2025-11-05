const Seller = require('../models/Seller');
const User = require('../models/User');
const { asyncHandler } = require('../middleware/errorMiddleware');

// Get all sellers (with approval status)
exports.getSellers = asyncHandler(async (req, res) => {
  const sellers = await Seller.find()
    .sort({ createdAt: -1 })
    .populate('userId', 'name email')
    .populate('approvedBy', 'name email')
    .populate('rejectedBy', 'name email')
    .populate('suspendedBy', 'name email');
  
  // Transform sellers: if commissionRate is 10 (old default), set to 7 (new default)
  const transformedSellers = sellers.map(seller => {
    const sellerObj = seller.toObject();
    // If commissionRate is 10 (old default) or not set, use 7 (new default)
    if (!sellerObj.commissionRate || sellerObj.commissionRate === 10) {
      sellerObj.commissionRate = 7;
    }
    return sellerObj;
  });
  
  res.json(transformedSellers);
});

// Approve a seller
exports.approveSeller = asyncHandler(async (req, res) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Seller not found', route: req.originalUrl || req.url });
  seller.isApproved = true;
  seller.approvalDate = new Date();
  seller.approvedBy = req.user._id;
  seller.rejectionReason = undefined;
  await seller.save();
  // Also update the corresponding user
  await User.findByIdAndUpdate(seller.userId, { role: 'seller', isActive: true });
  res.json({ message: 'Seller approved', seller });
});

// Reject a seller
exports.rejectSeller = asyncHandler(async (req, res) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Seller not found', route: req.originalUrl || req.url });
  seller.isApproved = false;
  seller.rejectionReason = req.body.reason || 'Rejected by admin';
  seller.approvalDate = undefined;
  seller.approvedBy = undefined; // Clear approval info
  seller.rejectedBy = req.user._id; // Set rejection info
  seller.rejectionDate = new Date();
  await seller.save();
  res.json({ message: 'Seller rejected', seller });
});

// Suspend seller
exports.suspendSeller = asyncHandler(async (req, res) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Seller not found' });
  
  seller.isSuspended = true;
  seller.suspensionReason = req.body.reason || 'Suspended by admin';
  seller.suspensionDate = new Date();
  seller.suspendedBy = req.user._id;
  
  // Also update the corresponding user to inactive
  await User.findByIdAndUpdate(seller.userId, { isActive: false });
  
  await seller.save();
  res.json({ message: 'Seller suspended successfully', seller });
});

// Activate seller
exports.activateSeller = asyncHandler(async (req, res) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ message: 'Seller not found' });
  
  seller.isSuspended = false;
  seller.suspensionReason = undefined;
  seller.suspensionDate = undefined;
  seller.suspendedBy = undefined;
  
  // Also update the corresponding user to active
  await User.findByIdAndUpdate(seller.userId, { isActive: true });
  
  await seller.save();
  res.json({ message: 'Seller activated successfully', seller });
});

// Placeholder: Get admin dashboard
exports.getDashboard = (req, res) => {
  res.json({ message: 'Get admin dashboard' });
};

// Get all users
exports.getUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select('-password');
  res.json(users);
});

// Create new user
exports.createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, isActive } = req.body;
  
  // Multiple admins are now allowed - admin role can be assigned
  // Admin can create other admins through this endpoint
  
  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ message: 'User with this email already exists' });
  }
  
  // Create new user
  const user = new User({
    name,
    email,
    password: password || 'temp123', // use provided password or default
    role: role || 'customer',
    isActive: isActive !== false // default to true
  });
  
  await user.save();
  
  // Return user without password
  const userResponse = user.toObject();
  delete userResponse.password;
  res.status(201).json(userResponse);
});

// Update a user
exports.updateUser = asyncHandler(async (req, res) => {
  const { name, email, role, isActive } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found', route: req.originalUrl || req.url });
  
  // Multiple admins are now allowed - admin role can be assigned
  // Admin can assign admin role to other users
  if (name) user.name = name;
  if (email) user.email = email;
  if (role) user.role = role; // Allow admin role assignment
  if (typeof isActive === 'boolean') user.isActive = isActive;
  await user.save();
  res.json(user);
});

// Block a user
exports.blockUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found', route: req.originalUrl || req.url });
  user.isActive = false;
  await user.save();
  res.json({ message: 'User blocked successfully', user });
});

// Unblock a user
exports.unblockUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found', route: req.originalUrl || req.url });
  user.isActive = true;
  await user.save();
  res.json({ message: 'User unblocked successfully', user });
});

// Get orders for a specific user
exports.getUserOrders = asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const orders = await require('../models/Order').find({ user: userId })
    .populate('seller', 'shopName')
    .populate('orderItems.product', 'name images')
    .sort({ createdAt: -1 });
  res.json(orders);
});

// Delete user
exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await require('../models/User').findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  
  await require('../models/User').findByIdAndDelete(req.params.id);
  res.json({ message: 'User deleted successfully' });
});

// Get all products
exports.getProducts = asyncHandler(async (req, res) => {
  const products = await require('../models/Product').find()
    .populate('seller', 'shopName email phone businessInfo')
    .populate('category', 'name')
    .sort({ createdAt: -1 });
  res.json(products);
});

// Approve a product
exports.approveProduct = asyncHandler(async (req, res) => {
  const product = await require('../models/Product').findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found', route: req.originalUrl || req.url });
  product.isApproved = true;
  product.approvalDate = new Date();
  product.approvedBy = req.user._id;
  product.rejectionReason = undefined;
  await product.save();
  res.json(product);
});

// Reject a product
exports.rejectProduct = asyncHandler(async (req, res) => {
  const product = await require('../models/Product').findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found', route: req.originalUrl || req.url });
  product.isApproved = false;
  product.rejectionReason = req.body.reason || 'Rejected by admin';
  product.approvalDate = undefined;
  product.approvedBy = req.user._id;
  await product.save();
  res.json(product);
});

// Bulk approve products
exports.bulkApproveProducts = asyncHandler(async (req, res) => {
  const { productIds } = req.body;
  
  if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({ message: 'Product IDs array is required' });
  }

  const Product = require('../models/Product');
  
  try {
    const result = await Product.updateMany(
      { _id: { $in: productIds } },
      { 
        $set: { 
          isApproved: true,
          approvalDate: new Date(),
          approvedBy: req.user._id,
          rejectionReason: undefined
        }
      }
    );

    res.json({ 
      message: `${result.modifiedCount} products approved successfully`,
      approvedCount: result.modifiedCount,
      totalRequested: productIds.length
    });
  } catch (error) {
    res.status(500).json({ message: 'Error bulk approving products', error: error.message });
  }
});

// Bulk reject products
exports.bulkRejectProducts = asyncHandler(async (req, res) => {
  const { productIds, reason } = req.body;
  
  if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({ message: 'Product IDs array is required' });
  }

  if (!reason || reason.trim() === '') {
    return res.status(400).json({ message: 'Rejection reason is required' });
  }

  const Product = require('../models/Product');
  
  try {
    const result = await Product.updateMany(
      { _id: { $in: productIds } },
      { 
        $set: { 
          isApproved: false,
          rejectionReason: reason.trim(),
          approvalDate: undefined,
          approvedBy: req.user._id
        }
      }
    );

    res.json({ 
      message: `${result.modifiedCount} products rejected successfully`,
      rejectedCount: result.modifiedCount,
      totalRequested: productIds.length,
      reason: reason.trim()
    });
  } catch (error) {
    res.status(500).json({ message: 'Error bulk rejecting products', error: error.message });
  }
});

// Get all orders
exports.getOrders = asyncHandler(async (req, res) => {
  const orders = await require('../models/Order').find()
    .populate('user', 'name email')
    .populate('seller', 'shopName')
    .populate('orderItems.product', 'name images');
  res.json(orders);
});

// List shipments with filters for admin
exports.getShipments = asyncHandler(async (req, res) => {
  const Order = require('../models/Order');
  const { status, search } = req.query; // status: processing|shipped|delivered|rto|cancelled|all

  const query = { 'shipment.shipmentId': { $exists: true, $ne: null } };
  if (status && status !== 'all') {
    if (status === 'rto') {
      query.$or = [ { 'shipment.isReturning': true }, { 'shipment.events.type': /rto/i } ];
    } else if (status === 'processing') {
      query.orderStatus = 'processing';
    } else if (status === 'shipped') {
      query.orderStatus = 'shipped';
    } else if (status === 'delivered') {
      query.orderStatus = 'delivered';
    } else if (status === 'cancelled') {
      query.orderStatus = 'cancelled';
    }
  }

  const orders = await Order.find(query)
    .populate('user', 'name email')
    .populate('seller', 'shopName')
    .sort({ createdAt: -1 });

  let results = orders;
  if (search) {
    const s = String(search).toLowerCase();
    results = orders.filter(o => (
      (o.orderNumber || '').toLowerCase().includes(s) ||
      (o.shipment?.awb || '').toLowerCase().includes(s) ||
      (o.user?.email || '').toLowerCase().includes(s) ||
      (o.seller?.shopName || '').toLowerCase().includes(s)
    ));
  }

  res.json(results);
});

// Get analytics/stats
exports.getAnalytics = asyncHandler(async (req, res) => {
  const pendingFilter = {
    isApproved: false,
    isSuspended: { $ne: true },
    $or: [
      { rejectionReason: { $exists: false } },
      { rejectionReason: null },
      { rejectionReason: '' }
    ]
  };

  const [totalUsers, totalProducts, totalOrders, totalVendors, pendingVendors, totalSales] = await Promise.all([
    User.countDocuments(),
    require('../models/Product').countDocuments(),
    require('../models/Order').countDocuments(),
    require('../models/Seller').countDocuments(),
    require('../models/Seller').countDocuments(pendingFilter),
    // Sales amount should include only qualifying orders
    require('../models/Order').aggregate([
      { $match: {
        orderStatus: { $nin: ['cancelled', 'refunded'] },
        $or: [
          { paymentMethod: { $ne: 'cod' }, paymentStatus: 'paid' },
          { paymentMethod: 'cod', orderStatus: 'delivered' }
        ]
      } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } }
    ]).then(r => r[0]?.total || 0)
  ]);
  res.json({
    totalUsers,
    totalProducts,
    totalOrders,
    totalVendors,
    pendingVendors,
    totalSales
  });
});

// Sales report: group by day/month/year
exports.getSalesReport = asyncHandler(async (req, res) => {
  const { period = 'daily', from, to } = req.query;
  const match = {
    orderStatus: { $nin: ['cancelled', 'refunded'] },
    $or: [
      { paymentMethod: { $ne: 'cod' }, paymentStatus: 'paid' },
      { paymentMethod: 'cod', orderStatus: 'delivered' }
    ]
  };
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lte = new Date(to);
  }
  const proj = {
    totalPrice: 1,
    createdAt: 1
  };
  let groupId;
  if (period === 'yearly') {
    groupId = { $dateToString: { format: '%Y', date: '$createdAt' } };
  } else if (period === 'monthly') {
    groupId = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
  } else {
    groupId = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
  }
  const data = await require('../models/Order').aggregate([
    { $match: match },
    { $project: proj },
    { $group: { _id: groupId, revenue: { $sum: '$totalPrice' }, orders: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  res.json({ period, data });
});

// Top products by quantity and revenue
exports.getTopProducts = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit || 10);
  const period = req.query.period || null; // daily | monthly | yearly | null
  const match = { 
    orderStatus: { $nin: ['cancelled', 'refunded'] }, 
    $or: [ 
      { paymentMethod: { $ne: 'cod' }, paymentStatus: 'paid' }, 
      { paymentMethod: 'cod', orderStatus: 'delivered' } 
    ]
  };
  
  if (period) {
    const now = new Date();
    let from;
    if (period === 'daily') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'monthly') {
      // last 30 days
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === 'yearly') {
      // last 365 days
      from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }
    if (from) match.createdAt = { $gte: from };
  }
  
  const data = await require('../models/Order').aggregate([
    { $match: match },
    { $unwind: '$orderItems' },
    { $group: {
      _id: '$orderItems.product',
      name: { $first: '$orderItems.name' },
      quantity: { $sum: '$orderItems.quantity' },
      revenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } }
    } },
    { $sort: { quantity: -1 } },
    { $limit: limit },
    { $match: { quantity: { $gt: 0 } } } // Only include products with quantity > 0
  ]);
  res.json(data);
});

// Top vendors by revenue
exports.getTopVendors = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit || 10);
  const period = req.query.period || null; // daily | monthly | yearly | null
  const match = { 
    orderStatus: { $nin: ['cancelled', 'refunded'] }, 
    $or: [ 
      { paymentMethod: { $ne: 'cod' }, paymentStatus: 'paid' }, 
      { paymentMethod: 'cod', orderStatus: 'delivered' } 
    ],
    seller: { $exists: true, $ne: null } // Ensure seller exists
  };
  if (period) {
    const now = new Date();
    let from;
    if (period === 'daily') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'monthly') {
      // last 30 days
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === 'yearly') {
      // last 365 days
      from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }
    if (from) match.createdAt = { $gte: from };
  }

  const data = await require('../models/Order').aggregate([
    { $match: match },
    { $group: { _id: '$seller', orders: { $sum: 1 }, revenue: { $sum: '$totalPrice' } } },
    { $sort: { revenue: -1 } },
    { $limit: limit },
    { $lookup: { from: 'sellers', localField: '_id', foreignField: '_id', as: 'seller' } },
    { $unwind: { path: '$seller', preserveNullAndEmptyArrays: true } },
    { 
      $project: { 
        _id: 1, 
        orders: { $ifNull: ['$orders', 0] }, 
        revenue: { $ifNull: ['$revenue', 0] }, 
        shopName: { 
          $ifNull: ['$seller.shopName', 'Unknown Vendor'] 
        }
      } 
    },
    { $match: { revenue: { $gt: 0 } } } // Only include vendors with revenue > 0
  ]);
  res.json(data);
});

// --- Admin Earnings (Commission) ---
exports.getAdminEarningsSummary = asyncHandler(async (req, res) => {
  const Order = require('../models/Order');
  // Online commission (non-COD paid)
  const onlineAgg = await Order.aggregate([
    { $match: { paymentMethod: { $ne: 'cod' }, paymentStatus: 'paid' } },
    { $project: { commEff: { $cond: [ { $gt: ['$commission', 0] }, '$commission', { $multiply: ['$itemsPrice', 0.07] } ] } } },
    { $group: { _id: null, total: { $sum: '$commEff' }, orders: { $sum: 1 } } }
  ]);
  // COD delivered commission
  const codAgg = await Order.aggregate([
    { $match: { paymentMethod: 'cod', orderStatus: 'delivered' } },
    { $project: { commEff: { $cond: [ { $gt: ['$commission', 0] }, '$commission', { $multiply: ['$itemsPrice', 0.07] } ] } } },
    { $group: { _id: null, total: { $sum: '$commEff' }, orders: { $sum: 1 } } }
  ]);

  const onlineCommission = onlineAgg[0]?.total || 0;
  const codCommission = codAgg[0]?.total || 0;
  const totalOrders = (onlineAgg[0]?.orders || 0) + (codAgg[0]?.orders || 0);
  const totalCommission = onlineCommission + codCommission;

  res.json({
    totalCommission,
    onlineCommission,
    codCommission,
    totalOrders
  });
});

exports.getAdminEarningsTrend = asyncHandler(async (req, res) => {
  const Order = require('../models/Order');
  const period = req.query.period || 'daily'; // daily | monthly | yearly
  let format = '%Y-%m-%d';
  if (period === 'monthly') format = '%Y-%m';
  if (period === 'yearly') format = '%Y';

  const data = await Order.aggregate([
    { $match: {
      $or: [
        { paymentMethod: { $ne: 'cod' }, paymentStatus: 'paid' },
        { paymentMethod: 'cod', orderStatus: 'delivered' }
      ]
    } },
    { $project: {
      createdAt: 1,
      commEff: { $cond: [ { $gt: ['$commission', 0] }, '$commission', { $multiply: ['$itemsPrice', 0.07] } ] }
    } },
    { $group: { _id: { $dateToString: { format, date: '$createdAt' } }, amount: { $sum: '$commEff' } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', amount: 1 } }
  ]);

  res.json(data);
});

// Wallet Management Functions
exports.getWalletOverview = asyncHandler(async (req, res) => {
  const Withdrawal = require('../models/Withdrawal');
  const Order = require('../models/Order');
  const UserModel = require('../models/User');

  const [totalSellers, totalWithdrawals, pendingWithdrawals, processedWithdrawals] = await Promise.all([
    Seller.countDocuments({ isApproved: true }),
    Withdrawal.countDocuments(),
    Withdrawal.countDocuments({ status: 'pending' }),
    // Dashboard "Processed" card should exclude paid and rejected
    Withdrawal.countDocuments({ $or: [ { status: 'processing' }, { status: 'processed' } ] })
  ]);

  // Platform commission balance (online paid + COD delivered)
  const [onlineCommissionAgg, codCommissionAgg] = await Promise.all([
    Order.aggregate([
      { $match: { paymentMethod: { $ne: 'cod' }, paymentStatus: 'paid' } },
      { $project: { commEff: { $cond: [ { $gt: ['$commission', 0] }, '$commission', { $multiply: ['$itemsPrice', 0.07] } ] } } },
      { $group: { _id: null, total: { $sum: '$commEff' } } }
    ]),
    Order.aggregate([
      { $match: { paymentMethod: 'cod', orderStatus: 'delivered' } },
      { $project: { commEff: { $cond: [ { $gt: ['$commission', 0] }, '$commission', { $multiply: ['$itemsPrice', 0.07] } ] } } },
      { $group: { _id: null, total: { $sum: '$commEff' } } }
    ])
  ]);

  const platformOnlineCommission = onlineCommissionAgg[0]?.total || 0;
  const platformCODCommission = codCommissionAgg[0]?.total || 0;
  const platformCommissionBalance = platformOnlineCommission + platformCODCommission;

  // Total seller wallets
  const sellersUsers = await UserModel.aggregate([
    { $match: { role: 'seller' } },
    { $group: { _id: null, total: { $sum: '$walletBalance' } } }
  ]);
  const totalSellerWalletBalance = sellersUsers[0]?.total || 0;

  res.json({
    totalSellers,
    totalWithdrawals,
    pendingWithdrawals,
    processedWithdrawals,
    platformOnlineCommission,
    platformCODCommission,
    platformCommissionBalance,
    totalSellerWalletBalance
  });
});

exports.getSellerEarnings = asyncHandler(async (req, res) => {
  const sellers = await Seller.find({ isApproved: true }).populate('userId', 'name email');
  const Order = require('../models/Order');
  const Withdrawal = require('../models/Withdrawal');

  const sellerEarningsRaw = await Promise.all(sellers.map(async (seller) => {
    const sellerUserId = seller.userId?._id ? seller.userId._id : seller.userId;
    // Compute earnings only from completed/qualifying orders to avoid inflated values
    const onlineOrders = await Order.find({ seller: seller._id, paymentMethod: { $ne: 'cod' }, paymentStatus: 'paid' });
    const codDelivered = await Order.find({ seller: seller._id, paymentMethod: 'cod', orderStatus: 'delivered' });
    const orders = [...onlineOrders, ...codDelivered];
    const totalEarnings = orders.reduce((sum, o) => {
      const base = (o.sellerEarnings && o.sellerEarnings > 0)
        ? o.sellerEarnings
        : (o.itemsPrice - (o.itemsPrice * 0.07));
      return sum + Math.max(0, base || 0);
    }, 0);

    // Amount actually paid out to the seller
    const paidAgg = await Withdrawal.aggregate([
      { $match: { seller: sellerUserId, $or: [ { status: 'paid' }, { status: 'processed' } ] } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const withdrawnAmount = paidAgg[0]?.total || 0;

    const currentBalance = Math.max(0, totalEarnings - withdrawnAmount);

    // Only include sellers who have at least one withdrawal (any status)
    const anyWithdrawal = await Withdrawal.countDocuments({ seller: sellerUserId }) > 0;
    if (!anyWithdrawal) return null;

    return {
      _id: seller._id,
      shopName: seller.shopName,
      email: seller.userId?.email || seller.email || '',
      isApproved: seller.isApproved,
      totalEarnings,
      withdrawnAmount,
      currentBalance
    };
  }));

  const sellerEarnings = sellerEarningsRaw.filter(Boolean);
  
  res.json(sellerEarnings);
});

// List cancellation requests for admin review
exports.getCancellationRequests = asyncHandler(async (req, res) => {
  const Order = require('../models/Order');
  const orders = await Order.find({
    $or: [
      { cancellationRequested: true },
      { refundStatus: 'pending' }
    ]
  })
    .populate('user', 'name email')
    .populate('seller', 'shopName');

  res.json(orders);
});

exports.getWithdrawalRequests = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  
  let query = {};
  if (status && status !== 'all') {
    query.status = status;
  }
  
  const withdrawals = await require('../models/Withdrawal').find(query)
    .populate('seller', 'shopName email')
    .sort({ createdAt: -1 });
  
  // Filter by search term if provided
  let filteredWithdrawals = withdrawals;
  if (search) {
    filteredWithdrawals = withdrawals.filter(withdrawal => 
      withdrawal.seller.shopName.toLowerCase().includes(search.toLowerCase()) ||
      withdrawal.seller.email.toLowerCase().includes(search.toLowerCase()) ||
      withdrawal._id.toString().includes(search)
    );
  }
  
  res.json(filteredWithdrawals);
}); 