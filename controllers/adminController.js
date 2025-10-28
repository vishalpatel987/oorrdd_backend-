const Seller = require('../models/Seller');
const User = require('../models/User');
const { asyncHandler } = require('../middleware/errorMiddleware');

// Get all sellers (with approval status)
exports.getSellers = asyncHandler(async (req, res) => {
  const sellers = await Seller.find()
    .populate('userId', 'name email')
    .populate('approvedBy', 'name email')
    .populate('rejectedBy', 'name email')
    .populate('suspendedBy', 'name email');
  res.json(sellers);
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
  if (name) user.name = name;
  if (email) user.email = email;
  if (role) user.role = role;
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

// Get analytics/stats
exports.getAnalytics = asyncHandler(async (req, res) => {
  const [totalUsers, totalProducts, totalOrders, totalVendors, pendingVendors, totalSales] = await Promise.all([
    User.countDocuments(),
    require('../models/Product').countDocuments(),
    require('../models/Order').countDocuments(),
    require('../models/Seller').countDocuments(),
    require('../models/Seller').countDocuments({ isApproved: false }),
    require('../models/Order').aggregate([
      { $group: { _id: null, total: { $sum: '$totalPrice' } } }
    ]).then(res => res[0]?.total || 0)
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

// Wallet Management Functions
exports.getWalletOverview = asyncHandler(async (req, res) => {
  const totalSellers = await Seller.countDocuments({ isApproved: true });
  const totalWithdrawals = await require('../models/Withdrawal').countDocuments();
  const pendingWithdrawals = await require('../models/Withdrawal').countDocuments({ status: 'pending' });
  const processedWithdrawals = await require('../models/Withdrawal').countDocuments({ status: 'processed' });
  
  res.json({
    totalSellers,
    totalWithdrawals,
    pendingWithdrawals,
    processedWithdrawals
  });
});

exports.getSellerEarnings = asyncHandler(async (req, res) => {
  const sellers = await Seller.find({ isApproved: true }).populate('userId', 'name email');
  
  const sellerEarnings = await Promise.all(sellers.map(async (seller) => {
    // Get seller's orders and calculate earnings
    const orders = await require('../models/Order').find({ 
      seller: seller._id,
      orderStatus: 'Completed'
    });
    
    const totalEarnings = orders.reduce((sum, order) => sum + (order.sellerEarnings || 0), 0);
    const totalWithdrawals = await require('../models/Withdrawal').find({ 
      seller: seller._id,
      status: 'processed'
    });
    const withdrawnAmount = totalWithdrawals.reduce((sum, withdrawal) => sum + withdrawal.amount, 0);
    const currentBalance = totalEarnings - withdrawnAmount;
    
    return {
      _id: seller._id,
      shopName: seller.shopName,
      email: seller.userId.email,
      isApproved: seller.isApproved,
      totalEarnings,
      withdrawnAmount,
      currentBalance
    };
  }));
  
  res.json(sellerEarnings);
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