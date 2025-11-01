const Order = require('../models/Order');
const Product = require('../models/Product');
const Seller = require('../models/Seller');
const User = require('../models/User');
const { asyncHandler } = require('../middleware/errorMiddleware');
const { verifyPayment, getPaymentDetails } = require('../utils/razorpay');
const rapidShyp = require('../services/rapidshypService');
const Coupon = require('../models/Coupon');

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
    // Commission & seller earnings (global 7%)
    const rate = 0.07;
    const commission = Number((itemsPrice * rate).toFixed(2));
    const sellerEarnings = Number((itemsPrice - commission).toFixed(2));
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
      commission,
      sellerEarnings,
      orderStatus: 'pending',
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'pending',
      shippingStatus: 'pending',
      coupon: coupon || undefined,
      discount: discount || 0,
    });
    await order.save();
    createdOrders.push(order);

    // COD: do NOT credit wallet immediately; credit after delivery in updateOrderStatus
  }
  // Mark coupon as used by this user (once per checkout)
  if (coupon) {
    try {
      const normalized = String(coupon).trim().toUpperCase();
      const c = await Coupon.findOneAndUpdate(
        { code: normalized, isActive: true },
        { $addToSet: { usedBy: userId } },
        { new: true }
      );
      if (c && c.usageLimit && c.usedBy && c.usedBy.length >= c.usageLimit) {
        c.isActive = false;
        await c.save();
      }
    } catch (e) {
      // Non-blocking
    }
  }
  // Clear user's cart after successful order creation
  try {
    await User.findByIdAndUpdate(userId, { $set: { cart: [] } });
  } catch (e) {}
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

      // Commission & seller earnings (global 7%)
      const rate = 0.07;
      const commission = Number((itemsPrice * rate).toFixed(2));
      const sellerEarnings = Number((itemsPrice - commission).toFixed(2));

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
        commission,
        sellerEarnings,
        orderStatus: 'confirmed',
        paymentStatus: 'paid',
        sellerCredited: false,
        shippingStatus: 'pending',
        coupon: coupon || undefined,
        discount: discount || 0,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      });
      
      await order.save();
      createdOrders.push(order);

      // Do NOT credit seller immediately; credit on delivery webhook to align with policy
    }

    // After all orders created successfully, mark coupon as used
    if (coupon) {
      try {
        const normalized = String(coupon).trim().toUpperCase();
        const c = await Coupon.findOneAndUpdate(
          { code: normalized, isActive: true },
          { $addToSet: { usedBy: userId } },
          { new: true }
        );
        if (c && c.usageLimit && c.usedBy && c.usedBy.length >= c.usageLimit) {
          c.isActive = false;
          await c.save();
        }
      } catch (e) {
        // ignore coupon update errors
      }
    }

    // Clear user's cart after successful order creation with payment
    try {
      await User.findByIdAndUpdate(userId, { $set: { cart: [] } });
    } catch (e) {}
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
      .populate('user', 'name email')
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
  // Do not allow updates on cancelled/refunded orders
  if (order.orderStatus === 'cancelled' || order.refundStatus === 'pending' || order.paymentStatus === 'refunded') {
    return res.status(400).json({ message: 'Order is cancelled/refunded and cannot be updated' });
  }
  order.orderStatus = status;
  // If COD and delivered now, mark paid and credit seller wallet
  if (order.paymentMethod === 'cod' && status === 'delivered' && order.paymentStatus !== 'paid') {
    order.paymentStatus = 'paid';
    // Ensure commission/sellerEarnings exist
    if (typeof order.commission !== 'number' || typeof order.sellerEarnings !== 'number') {
      const itemsPrice = order.itemsPrice || (order.orderItems || []).reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
      const rate = 0.07;
      order.commission = Number((itemsPrice * rate).toFixed(2));
      order.sellerEarnings = Number((itemsPrice - order.commission).toFixed(2));
    }
    const Seller = require('../models/Seller');
    const sellerDocForUser = await Seller.findById(order.seller).select('userId');
    if (sellerDocForUser?.userId && order.sellerEarnings) {
      await require('../models/User').findByIdAndUpdate(
        sellerDocForUser.userId,
        { $inc: { walletBalance: order.sellerEarnings } }
      );
    }
  }
  await order.save();
  res.json(order);
});

// Cancel order
exports.cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('user', 'name email phone').populate('seller');
  if (!order) return res.status(404).json({ message: 'Order not found', route: req.originalUrl || req.url });
  
  const previousStatus = order.orderStatus;
  order.orderStatus = 'cancelled';
  order.cancelledAt = new Date();
  order.cancellationReason = req.body.reason || '';
  order.cancelledBy = req.user._id;

  // Handle RTO (Return to Origin) if shipment exists
  if (order.shipment?.shipmentId && order.shipment.status !== 'cancelled' && order.shipment.status !== 'returned') {
    // Mark shipment as returning (RTO)
    order.shipment.isReturning = true;
    order.shipment.status = 'rto';

    // Create RTO shipment via RapidShyp if order was shipped
    if (order.shippingStatus === 'shipped' && previousStatus === 'processing') {
      try {
        const seller = await Seller.findById(order.seller);
        if (seller) {
          // Prepare pickup address (customer's address - where to pick up from)
          const pickupAddress = {
            name: `${order.user?.name || ''}`,
            phone: order.shippingAddress?.phone || order.user?.phone || '',
            address: order.shippingAddress?.street || '',
            pincode: order.shippingAddress?.zipCode || '',
            city: order.shippingAddress?.city || '',
            state: order.shippingAddress?.state || '',
            country: order.shippingAddress?.country || 'India',
            email: order.user?.email || ''
          };

          // Prepare return address (seller's address - where to return to)
          const returnAddress = {
            name: seller.shopName,
            phone: seller.phone,
            address: seller.address?.street || '',
            pincode: seller.address?.zipCode || '',
            city: seller.address?.city || '',
            state: seller.address?.state || '',
            country: seller.address?.country || 'India',
            email: seller.email || ''
          };

          // Calculate weight (approximate: 500g per item)
          const weight = order.orderItems.reduce((sum, item) => sum + (item.quantity * 0.5), 0.5);

          // Create RTO shipment via RapidShyp
          const rtoResult = await rapidShyp.createRTO({
            orderId: order.orderNumber || order._id.toString(),
            originalAwb: order.shipment.awb,
            pickupAddress,
            returnAddress,
            weight,
            reason: `Order cancelled - ${order.cancellationReason || 'Customer refused delivery'}`
          });

          if (rtoResult.success) {
            // Update order shipment with RTO details
            order.shipment.events = order.shipment.events || [];
            order.shipment.events.push({
              type: 'rto_created',
              at: new Date(),
              raw: rtoResult.data
            });

            // Store RTO shipment details in order if available
            if (rtoResult.data) {
              const responseData = rtoResult.data;
              
              // Handle different response structures
              if (responseData.shipment && Array.isArray(responseData.shipment) && responseData.shipment.length > 0) {
                const rtoShipment = responseData.shipment[0];
                order.shipment.rtoShipmentId = rtoShipment.shipmentId || rtoShipment.shipment_id;
                order.shipment.rtoAwb = rtoShipment.awb || '';
                if (rtoShipment.awb) {
                  order.trackingUrl = rtoShipment.labelURL || rtoShipment.label_url || `https://track.rapidshyp.com/?awb=${rtoShipment.awb}`;
                  order.shipment.trackingUrl = order.trackingUrl;
                }
              } else if (responseData.awb || responseData.shipment_id || responseData.shipmentId) {
                order.shipment.rtoShipmentId = responseData.shipmentId || responseData.shipment_id || responseData.orderId || responseData.order_id;
                order.shipment.rtoAwb = responseData.awb || '';
                if (responseData.awb) {
                  order.trackingUrl = responseData.labelURL || responseData.label_url || `https://track.rapidshyp.com/?awb=${responseData.awb}`;
                  order.shipment.trackingUrl = order.trackingUrl;
                }
              }
            }

            console.log(`RTO shipment created for order ${order._id}`);
          } else {
            console.warn(`RTO shipment creation had issues for order ${order._id}:`, rtoResult.error || rtoResult.data?.message);
            // Order is still cancelled, RTO might be handled automatically by RapidShyp
            // or may need manual handling
          }
        }
      } catch (rtoError) {
        console.error('Error creating RTO shipment via RapidShyp:', rtoError);
        // Don't fail order cancellation if RTO creation fails
      }
    }
  }

  await order.save();
  res.json(order);
}); 

// User: request cancellation (pending admin approval)
exports.requestCancelOrder = asyncHandler(async (req, res) => {
  const id = req.params.id;
  let order = null;
  // Try by ObjectId first
  if (id && id.match(/^[0-9a-fA-F]{24}$/)) {
    order = await Order.findById(id).populate('seller');
  }
  // Fallback: try by orderNumber if provided
  if (!order) {
    order = await Order.findOne({ orderNumber: id }).populate('seller');
  }
  if (!order) return res.status(404).json({ message: 'Order not found' });
  // allow cancel request only if not shipped/delivered/cancelled
  if (['shipped', 'delivered', 'cancelled', 'refunded'].includes(order.orderStatus)) {
    return res.status(400).json({ message: 'Order cannot be cancelled at this stage' });
  }
  order.cancellationRequested = true;
  order.cancellationRequestReason = req.body.reason || '';
  order.cancellationRequestedAt = new Date();
  await order.save();

  // Notify vendor by email
  try {
    const sendEmail = require('../utils/sendEmail');
    const sellerEmail = order.seller?.email;
    if (sellerEmail) {
      await sendEmail({
        email: sellerEmail,
        subject: `Order ${order.orderNumber || order._id} cancellation requested`,
        message: `A customer requested cancellation for order ${order.orderNumber || order._id}. Reason: ${order.cancellationRequestReason}`
      });
    }
  } catch (e) {}

  res.json({ message: 'Cancellation requested. Admin will review this request.' });
});

// Admin: approve cancellation (no refund here)
exports.adminApproveCancellation = asyncHandler(async (req, res) => {
  const OrderModel = require('../models/Order');
  const Seller = require('../models/Seller');
  const User = require('../models/User');
  const order = await OrderModel.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });

  order.cancellationApprovedAt = new Date();
  order.cancellationApprovedBy = req.user._id;
  order.orderStatus = 'cancelled';
  // For online orders, mark refund pending to show refund button in admin
  if (order.paymentMethod !== 'cod') {
    order.refundStatus = 'pending';
  }

  await order.save();
  res.json({ message: 'Order cancellation approved', order });
});

// Admin: refund now for approved cancellations (online payments)
exports.adminRefundOrder = asyncHandler(async (req, res) => {
  const OrderModel = require('../models/Order');
  const Seller = require('../models/Seller');
  const User = require('../models/User');
  const { refundPayment } = require('../utils/razorpay');
  const sendEmail = require('../utils/sendEmail');

  const order = await OrderModel.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (order.paymentMethod === 'cod') return res.status(400).json({ message: 'COD orders do not require online refund' });
  if (order.paymentStatus !== 'paid' || order.refundStatus !== 'pending') {
    return res.status(400).json({ message: 'Refund not applicable' });
  }

  const paymentId = order.razorpayPaymentId || order.paymentResult?.id;
  if (!paymentId) return res.status(400).json({ message: 'No payment id to refund' });

  const refundAmount = order.itemsPrice || order.totalPrice || 0;
  await refundPayment(paymentId, refundAmount);
  order.paymentStatus = 'refunded';
  order.refundStatus = 'refunded';

  // Reverse seller wallet if previously credited
  if (order.sellerEarnings) {
    const sellerDocForUser = await Seller.findById(order.seller).select('userId');
    if (sellerDocForUser?.userId) {
      await User.findByIdAndUpdate(sellerDocForUser.userId, { $inc: { walletBalance: -Math.abs(order.sellerEarnings) } });
    }
  }

  await order.save();
  // Notify customer via email (best-effort)
  try {
    const user = await User.findById(order.user);
    if (user?.email) {
      await sendEmail({
        email: user.email,
        subject: `Refund processed for order ${order.orderNumber || order._id}`,
        message: `Your refund of INR ${refundAmount} has been processed to your original payment method via Razorpay. It may take 5-7 business days to reflect.`
      });
    }
  } catch (e) {
    // ignore email errors
  }

  res.json({ message: 'Refund processed', refundedAmount: refundAmount, order });
});