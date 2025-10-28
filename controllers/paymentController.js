const { asyncHandler } = require('../middleware/errorMiddleware');
const { 
  createRazorpayOrder, 
  verifyPayment, 
  getPaymentDetails 
} = require('../utils/razorpay');

// Create Razorpay Payment Order
exports.createPaymentOrder = asyncHandler(async (req, res) => {
  if (!req.user || !req.user._id) {
    return res.status(401).json({ 
      success: false,
      message: 'User not authenticated', 
      route: req.originalUrl || req.url 
    });
  }

  const { amount, currency = 'INR', items } = req.body;
  const userId = req.user._id;

  // Validation
  if (!amount || amount <= 0) {
    return res.status(400).json({ 
      success: false,
      message: 'Invalid amount', 
      route: req.originalUrl || req.url 
    });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ 
      success: false,
      message: 'Items are required', 
      route: req.originalUrl || req.url 
    });
  }

  try {
    // Create receipt ID (max 40 characters for Razorpay)
    const timestamp = Date.now().toString().slice(-8); // Last 8 digits
    const userIdShort = userId.toString().slice(-8); // Last 8 characters
    const receipt = `rcpt_${userIdShort}_${timestamp}`;
    
    // Create Razorpay order
    const razorpayOrder = await createRazorpayOrder(amount, currency, receipt);
    
    res.status(200).json({
      success: true,
      data: {
        order: razorpayOrder,
        key: process.env.RAZORPAY_KEY_ID
      },
      message: 'Razorpay order created successfully'
    });
  } catch (error) {
    console.error('Payment order creation error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create payment order', 
      error: error.message,
      route: req.originalUrl || req.url 
    });
  }
});

// Verify Payment Signature
exports.verifyPayment = asyncHandler(async (req, res) => {
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
    razorpay_signature 
  } = req.body;

  // Validation
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ 
      success: false,
      message: 'Missing payment verification data', 
      route: req.originalUrl || req.url 
    });
  }

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

    res.status(200).json({
      success: true,
      data: {
        paymentVerified: true,
        paymentDetails,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      },
      message: 'Payment verified successfully'
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Payment verification failed', 
      error: error.message,
      route: req.originalUrl || req.url 
    });
  }
});

// Get Payment Status
exports.getPaymentStatus = asyncHandler(async (req, res) => {
  if (!req.user || !req.user._id) {
    return res.status(401).json({ 
      success: false,
      message: 'User not authenticated', 
      route: req.originalUrl || req.url 
    });
  }

  const { paymentId } = req.params;

  if (!paymentId) {
    return res.status(400).json({ 
      success: false,
      message: 'Payment ID is required', 
      route: req.originalUrl || req.url 
    });
  }

  try {
    const paymentDetails = await getPaymentDetails(paymentId);
    
    res.status(200).json({
      success: true,
      data: {
        paymentDetails
      },
      message: 'Payment status retrieved successfully'
    });

  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get payment status', 
      error: error.message,
      route: req.originalUrl || req.url 
    });
  }
});
