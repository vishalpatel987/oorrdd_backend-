const Order = require('../models/Order');
const Product = require('../models/Product');
const Seller = require('../models/Seller');
const User = require('../models/User');
const { asyncHandler } = require('../middleware/errorMiddleware');
const { verifyPayment, getPaymentDetails } = require('../utils/razorpay');

// Create Order: Splits cart by seller, creates separate orders for each seller
exports.createOrder = asyncHandler(async (req, res) => {
  if (!req.user || !req.user._id) {
    return res.status(401).json({ message: 'User not authenticated', route: req.originalUrl || req.url });
  }
  const { shippingAddress, items, paymentMethod, cardData, coupon, discount, total } = req.body;
  const userId = req.user._id;

  // Group items by seller
  const itemsBySeller = {};
  for (const item of items) {
    if (!item.product || !item.seller) {
      return res.status(400).json({ message: 'Product or seller missing in order item.', route: req.originalUrl || req.url });
    }
    if (!itemsBySeller[item.seller]) itemsBySeller[item.seller] = [];
    itemsBySeller[item.seller].push(item);
  }

  const createdOrders = [];
  for (const sellerId of Object.keys(itemsBySeller)) {
    const sellerItems = itemsBySeller[sellerId];
    // Fetch product details for each item
    const orderItems = await Promise.all(sellerItems.map(async (item) => {
      const product = await Product.findById(item.product);
      if (!product) {
        const error = new Error(`Product not found: ${item.product}`);
        error.type = 'OrderProductNotFound';
        throw error;
      }
      if (!product.seller || product.seller.toString() !== sellerId) {
        const error = new Error(`Product seller mismatch for product ${product._id}`);
        error.type = 'OrderProductSellerMismatch';
        throw error;
      }
      // Increment totalSold for the product
      product.totalSold = (product.totalSold || 0) + item.quantity;
      await product.save();
      return {
        product: product._id,
        name: product.name,
        image: product.images && product.images[0] ? product.images[0].url : '',
        price: product.price,
        quantity: item.quantity,
        sku: product.sku || '',
      };
    }));
    // Calculate totals
    const itemsPrice = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const shippingPrice = 0;
    const taxPrice = 0;
    const totalPrice = itemsPrice + shippingPrice + taxPrice - (discount || 0);
    // Save order
    const order = new Order({
      user: userId,
      seller: sellerId,
      orderItems,
      shippingAddress: {
        type: shippingAddress.type || 'home',
        street: shippingAddress.street,
        city: shippingAddress.city,
        state: shippingAddress.state,
        zipCode: shippingAddress.zipCode,
        country: shippingAddress.country,
        phone: shippingAddress.phone || '',
      },
      paymentMethod: paymentMethod === 'cod' ? 'cod' : paymentMethod,
      itemsPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
      orderStatus: 'pending',
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'pending',
      shippingStatus: 'pending',
      coupon: coupon || undefined,
      discount: discount || 0,
    });
    await order.save();
    createdOrders.push(order);

    // Add commission to seller's wallet balance (COD orders)
    const commission = (itemsPrice * 0.05); // 5% commission for platform
    const sellerEarnings = itemsPrice - commission;
    
    await User.findByIdAndUpdate(
      sellerId,
      { $inc: { walletBalance: sellerEarnings } }
    );
  }
  res.status(201).json({ orders: createdOrders });
});

// Create Order with Razorpay Payment Verification
exports.createOrderWithPayment = asyncHandler(async (req, res) => {
  if (!req.user || !req.user._id) {
    return res.status(401).json({ 
      success: false,
      message: 'User not authenticated', 
      route: req.originalUrl || req.url 
    });
  }

  const { 
    razorpay_order_id, 
    razorpay_payment_id, 
    razorpay_signature,
    shippingAddress, 
    items, 
    paymentMethod,
    coupon, 
    discount, 
    total 
  } = req.body;
  
  const userId = req.user._id;

  try {
    // Verify payment signature
    const isPaymentVerified = verifyPayment(
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature
    );
    
    if (!isPaymentVerified) {
      return res.status(400).json({ 
        success: false,
        message: 'Payment verification failed', 
        route: req.originalUrl || req.url 
      });
    }

    // Get payment details from Razorpay
    const paymentDetails = await getPaymentDetails(razorpay_payment_id);
    
    if (paymentDetails.status !== 'captured') {
      return res.status(400).json({ 
        success: false,
        message: 'Payment not captured', 
        route: req.originalUrl || req.url 
      });
    }

    // Group items by seller
    const itemsBySeller = {};
    for (const item of items) {
      if (!item.product || !item.seller) {
        return res.status(400).json({ 
          success: false,
          message: 'Product or seller missing in order item.', 
          route: req.originalUrl || req.url 
        });
      }
      if (!itemsBySeller[item.seller]) itemsBySeller[item.seller] = [];
      itemsBySeller[item.seller].push(item);
    }

    const createdOrders = [];
    
    for (const sellerId of Object.keys(itemsBySeller)) {
      const sellerItems = itemsBySeller[sellerId];
      
      // Fetch product details for each item
      const orderItems = await Promise.all(sellerItems.map(async (item) => {
        const product = await Product.findById(item.product);
        if (!product) {
          const error = new Error(`Product not found: ${item.product}`);
          error.type = 'OrderProductNotFound';
          throw error;
        }
        if (!product.seller || product.seller.toString() !== sellerId) {
          const error = new Error(`Product seller mismatch for product ${product._id}`);
          error.type = 'OrderProductSellerMismatch';
          throw error;
        }
        
        // Check stock availability
        if (product.stock < item.quantity) {
          const error = new Error(`Insufficient stock for product ${product.name}`);
          error.type = 'InsufficientStock';
          throw error;
        }
        
        // Decrement stock
        product.stock -= item.quantity;
        product.totalSold = (product.totalSold || 0) + item.quantity;
        await product.save();
        
        return {
          product: product._id,
          name: product.name,
          image: product.images && product.images[0] ? product.images[0].url : '',
          price: product.price,
          quantity: item.quantity,
          sku: product.sku || '',
        };
      }));

      // Calculate totals
      const itemsPrice = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
      const shippingPrice = 0;
      const taxPrice = 0;
      const totalPrice = itemsPrice + shippingPrice + taxPrice - (discount || 0);

      // Save order with payment details
      const order = new Order({
        user: userId,
        seller: sellerId,
        orderItems,
        shippingAddress: {
          type: shippingAddress.type || 'home',
          street: shippingAddress.street,
          city: shippingAddress.city,
          state: shippingAddress.state,
          zipCode: shippingAddress.zipCode,
          country: shippingAddress.country,
          phone: shippingAddress.phone || '',
        },
        paymentMethod: paymentMethod || 'razorpay',
        paymentResult: {
          id: razorpay_payment_id,
          status: 'captured',
          update_time: new Date().toISOString(),
          email_address: req.user.email,
        },
        itemsPrice,
        taxPrice,
        shippingPrice,
        totalPrice,
        orderStatus: 'confirmed', // Payment successful, so order is confirmed
        paymentStatus: 'paid',
        shippingStatus: 'pending',
        coupon: coupon || undefined,
        discount: discount || 0,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      });
      
      await order.save();
      createdOrders.push(order);

      // Add commission to seller's wallet balance
      const commission = (itemsPrice * 0.05); // 5% commission for platform
      const sellerEarnings = itemsPrice - commission;
      
      await User.findByIdAndUpdate(
        sellerId,
        { $inc: { walletBalance: sellerEarnings } }
      );
    }

    res.status(201).json({ 
      success: true,
      data: {
        orders: createdOrders,
        paymentDetails
      },
      message: 'Payment verified and orders created successfully'
    });

  } catch (error) {
    console.error('Order creation with payment error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Payment verification or order creation failed', 
      error: error.message,
      route: req.originalUrl || req.url 
    });
  }
});

// Get Orders: For user or seller
exports.getOrders = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const isSeller = req.query.seller === 'true' || req.user.role === 'seller';
  let orders;
  if (isSeller) {
    // Seller: fetch orders for this seller
    const sellerDoc = await Seller.findOne({ userId: userId });
    if (!sellerDoc) return res.json({ orders: [] });
    orders = await Order.find({ seller: sellerDoc._id })
      .populate('user', 'firstName lastName email')
      .populate('orderItems.product', 'name');
  } else {
    // User: fetch orders placed by this user
    orders = await Order.find({ user: userId })
      .populate('seller', 'shopName')
      .populate('orderItems.product', 'name');
  }
  res.json({ orders });
});

// Get single order by ID
exports.getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'firstName lastName email')
    .populate('seller', 'shopName')
    .populate('orderItems.product', 'name');
  if (!order) return res.status(404).json({ message: 'Order not found', route: req.originalUrl || req.url });
  res.json(order);
});

// Update order status (for seller)
exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found', route: req.originalUrl || req.url });
  order.orderStatus = status;
  await order.save();
  res.json(order);
});

// Cancel order
exports.cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found', route: req.originalUrl || req.url });
  order.orderStatus = 'cancelled';
  order.cancelledAt = new Date();
  order.cancellationReason = req.body.reason || '';
  order.cancelledBy = req.user._id;
  await order.save();
  res.json(order);
}); 