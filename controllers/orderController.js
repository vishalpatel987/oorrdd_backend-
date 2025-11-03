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

// Generate invoice (PDF with fallback to HTML)
// Access: buyer, seller of the order, or admin
exports.getOrderInvoice = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'name email phone')
    .populate('seller');
  if (!order) return res.status(404).json({ message: 'Order not found', route: req.originalUrl || req.url });

  // Authorization: owner (user), seller (by userId), or admin
  let authorized = false;
  if (String(order.user) === String(req.user._id)) authorized = true;
  if (req.user.role === 'admin') authorized = true;
  if (!authorized && req.user.role === 'seller') {
    const Seller = require('../models/Seller');
    const sellerDoc = await Seller.findById(order.seller).select('userId');
    if (sellerDoc && String(sellerDoc.userId) === String(req.user._id)) authorized = true;
  }
  if (!authorized) return res.status(403).json({ message: 'Not authorized to view this invoice' });

  // Try PDF
  try {
    const PDFDocument = require('pdfkit');
    // Resolve coupon details (percent vs flat) for display
    let couponDisplay = '';
    let couponPercent = null;
    let couponFlat = null;
    try {
      const codeRaw = (typeof order.coupon === 'string' ? order.coupon : (order.coupon?.code || '')).trim();
      if (codeRaw) {
        const Coupon = require('../models/Coupon');
        const couponDoc = await Coupon.findOne({ code: codeRaw.toUpperCase() }).select('code discount');
        if (couponDoc) {
          if (couponDoc.discount > 0 && couponDoc.discount <= 100) couponPercent = couponDoc.discount;
          else if (couponDoc.discount > 100) couponFlat = couponDoc.discount;
        }
        couponDisplay = codeRaw.toUpperCase();
      }
    } catch (e) { /* non-blocking */ }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=invoice-${order.orderNumber || order._id}.pdf`);
    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    // Header
    doc.fontSize(20).text('Invoice', { align: 'right' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Invoice No: ${order.orderNumber || order._id}`);
    doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`);
    doc.moveDown(1);

    // Seller & Buyer
    const seller = order.seller || {};
    const buyer = order.user || {};
    const sAddr = seller.address || {};
    const bAddr = order.shippingAddress || {};
    doc.fontSize(12).text('From:', { continued: true }).font('Helvetica-Bold').text(` ${seller.shopName || 'Vendor'}`);
    doc.font('Helvetica').fontSize(10).text(`${sAddr.street || ''}`);
    doc.text(`${sAddr.city || ''}, ${sAddr.state || ''} ${sAddr.zipCode || ''}`);
    doc.text(`${sAddr.country || ''}`);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(12).text('Bill To:', { continued: true }).font('Helvetica-Bold').text(` ${buyer.name || buyer.email || ''}`);
    doc.font('Helvetica').fontSize(10).text(`${bAddr.street || ''}`);
    doc.text(`${bAddr.city || ''}, ${bAddr.state || ''} ${bAddr.zipCode || ''}`);
    doc.text(`${bAddr.country || ''}`);
    doc.moveDown(1);

    // Items table
    doc.font('Helvetica-Bold').text('Items');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10);
    const tableTop = doc.y;
    const col = (x) => 40 + x;
    doc.text('Item', col(0), tableTop);
    doc.text('Qty', col(280), tableTop);
    doc.text('Price', col(330), tableTop);
    doc.text('Total', col(400), tableTop);
    doc.moveDown(0.4);
    doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.2);
    let subtotal = 0;
    for (const it of order.orderItems || []) {
      const lineTop = doc.y;
      const lineTotal = (it.price || 0) * (it.quantity || 0);
      subtotal += lineTotal;
      doc.text(it.name || '', col(0), lineTop, { width: 260 });
      doc.text(String(it.quantity || 0), col(280), lineTop);
      doc.text(`${(it.price || 0).toFixed(2)}`, col(330), lineTop);
      doc.text(`${lineTotal.toFixed(2)}`, col(400), lineTop);
      doc.moveDown(0.2);
    }
    doc.moveDown(0.4);
    doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.4);

    // Summary
    const itemsPrice = order.itemsPrice || subtotal;
    const shippingPrice = order.shippingPrice || 0;
    const taxPrice = order.taxPrice || 0;
    const storedDiscount = Number(order.discount || 0);
    const couponCode = typeof order.coupon === 'string' ? order.coupon : (order.coupon?.code || '');
    const computedGross = (itemsPrice + shippingPrice + taxPrice);
    const totalPrice = (typeof order.totalPrice === 'number') ? order.totalPrice : (computedGross - storedDiscount);
    // If discount not stored but total is discounted, infer effective discount
    const effectiveDiscount = storedDiscount > 0 ? storedDiscount : Math.max(0, computedGross - (Number(totalPrice) || computedGross));
    doc.text(`Items: ₹${itemsPrice.toFixed(2)}`, { align: 'right' });
    doc.text(`Shipping: ₹${shippingPrice.toFixed(2)}`, { align: 'right' });
    doc.text(`Tax: ₹${taxPrice.toFixed(2)}`, { align: 'right' });
    if (effectiveDiscount > 0) {
      const labelParts = [];
      if (couponCode) labelParts.push(couponCode);
      if (couponPercent) labelParts.push(`${couponPercent}%`);
      if (couponFlat && !couponPercent) labelParts.push(`₹${Number(couponFlat).toFixed(2)}`);
      const label = labelParts.length ? ` (${labelParts.join(' — ')})` : '';
      doc.text(`Discount${label}: -₹${effectiveDiscount.toFixed(2)}`, { align: 'right' });
      doc.fontSize(9).fillColor('#6b7280').text(`You saved ₹${effectiveDiscount.toFixed(2)} with coupon${couponDisplay ? ` ${couponDisplay}` : ''}.`, { align: 'right' });
      doc.fillColor('black').fontSize(10);
    }
    doc.font('Helvetica-Bold').text(`Total: ₹${totalPrice.toFixed(2)}`, { align: 'right' });
    doc.font('Helvetica').moveDown(1);
    doc.text(`Payment: ${order.paymentMethod?.toUpperCase() || ''} — ${order.paymentStatus || 'pending'}`);
    doc.moveDown(1);
    doc.fontSize(10).fillColor('#666666').text('Thank you for your business. This is a computer generated invoice.');

    doc.end();
  } catch (e) {
    // Fallback: HTML invoice
    const seller = order.seller || {};
    const buyer = order.user || {};
    const sAddr = seller.address || {};
    const bAddr = order.shippingAddress || {};
    const rows = (order.orderItems || []).map(it => `
      <tr>
        <td style="padding:6px 8px;border:1px solid #e5e7eb">${it.name || ''}</td>
        <td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right">${it.quantity || 0}</td>
        <td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right">₹${(it.price || 0).toFixed(2)}</td>
        <td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right">₹${(((it.price || 0) * (it.quantity || 0))).toFixed(2)}</td>
      </tr>`).join('');
    const itemsPrice = order.itemsPrice || 0;
    const shippingPrice = order.shippingPrice || 0;
    const taxPrice = order.taxPrice || 0;
    const storedDiscount = Number(order.discount || 0);
    const couponCode = typeof order.coupon === 'string' ? order.coupon : (order.coupon?.code || '');
    const gross = itemsPrice + shippingPrice + taxPrice;
    const totalPrice = (typeof order.totalPrice === 'number') ? order.totalPrice : (gross - storedDiscount);
    const effectiveDiscount = storedDiscount > 0 ? storedDiscount : Math.max(0, gross - (Number(totalPrice) || gross));

    // Build discount display strings safely for HTML
    let couponPercentHtml = '';
    let couponFlatHtml = '';
    try {
      if (couponCode) {
        const Coupon = require('../models/Coupon');
        const c = await Coupon.findOne({ code: String(couponCode).toUpperCase() }).select('discount');
        if (c) {
          if (c.discount > 0 && c.discount <= 100) couponPercentHtml = `${c.discount}%`;
          else if (c.discount > 100) couponFlatHtml = `₹${Number(c.discount).toFixed(2)}`;
        }
      }
    } catch (e) { /* non-blocking */ }

    const labelPartsHtml = [];
    if (couponCode) labelPartsHtml.push(String(couponCode).toUpperCase());
    if (couponPercentHtml) labelPartsHtml.push(couponPercentHtml);
    else if (couponFlatHtml) labelPartsHtml.push(couponFlatHtml);
    const discountLabelSuffix = labelPartsHtml.length ? ` (${labelPartsHtml.join(' — ')})` : '';
    const discountRowHTML = effectiveDiscount > 0
      ? `<div style="display:flex;justify-content:space-between"><span>Discount${discountLabelSuffix}</span><span>-₹${effectiveDiscount.toFixed(2)}</span></div>`
      : '';
    const savedNoteHTML = effectiveDiscount > 0
      ? `<div style="margin-top:4px;font-size:12px;color:#6b7280;text-align:right">You saved ₹${effectiveDiscount.toFixed(2)}${couponCode ? ` with coupon ${String(couponCode).toUpperCase()}` : ''}.</div>`
      : '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`
      <!doctype html>
      <html><head><meta charset="utf-8"/><title>Invoice ${order.orderNumber || order._id}</title>
      <style>body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;color:#111827}</style>
      </head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:24px;font-weight:700">Invoice</div>
          <div style="font-size:12px;color:#6b7280">Invoice No: ${order.orderNumber || order._id}</div>
          <div style="font-size:12px;color:#6b7280">Date: ${new Date(order.createdAt).toLocaleDateString()}</div>
        </div>
      </div>
      <div style="display:flex;gap:48px;margin:16px 0 24px">
        <div>
          <div style="font-weight:600">From</div>
          <div>${seller.shopName || 'Vendor'}</div>
          <div style="font-size:12px;color:#6b7280">${sAddr.street || ''}</div>
          <div style="font-size:12px;color:#6b7280">${sAddr.city || ''}, ${sAddr.state || ''} ${sAddr.zipCode || ''}</div>
          <div style="font-size:12px;color:#6b7280">${sAddr.country || ''}</div>
        </div>
        <div>
          <div style="font-weight:600">Bill To</div>
          <div>${buyer.name || buyer.email || ''}</div>
          <div style="font-size:12px;color:#6b7280">${bAddr.street || ''}</div>
          <div style="font-size:12px;color:#6b7280">${bAddr.city || ''}, ${bAddr.state || ''} ${bAddr.zipCode || ''}</div>
          <div style="font-size:12px;color:#6b7280">${bAddr.country || ''}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 8px;border:1px solid #e5e7eb">Item</th>
            <th style="text-align:right;padding:6px 8px;border:1px solid #e5e7eb">Qty</th>
            <th style="text-align:right;padding:6px 8px;border:1px solid #e5e7eb">Price</th>
            <th style="text-align:right;padding:6px 8px;border:1px solid #e5e7eb">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-left:auto;max-width:320px">
        <div style="display:flex;justify-content:space-between"><span>Items</span><span>₹${itemsPrice.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between"><span>Shipping</span><span>₹${shippingPrice.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between"><span>Tax</span><span>₹${taxPrice.toFixed(2)}</span></div>
        ${discountRowHTML}
        <div style="display:flex;justify-content:space-between;font-weight:700"><span>Total</span><span>₹${totalPrice.toFixed(2)}</span></div>
        <div style="margin-top:8px;font-size:12px;color:#6b7280">Payment: ${order.paymentMethod?.toUpperCase() || ''} — ${order.paymentStatus || 'pending'}</div>
        ${savedNoteHTML}
      </div>
      <p style="font-size:12px;color:#6b7280;margin-top:24px">Thank you for your business.</p>
      <script>window.onload = () => { window.print && window.print(); };</script>
      </body></html>
    `);
  }
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