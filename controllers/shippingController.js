const { asyncHandler } = require('../middleware/errorMiddleware');
const Order = require('../models/Order');
const Seller = require('../models/Seller');
const rapidShyp = require('../services/rapidshypService');
const { getStatusDetails, mapToOrderStatus, mapToShippingStatus, isRTOStatus, processTrackingResponse } = require('../utils/rapidshypStatusMapper');

/**
 * Get courier rates for a shipment
 * POST /api/shipping/rates
 * Body: { pickupPincode, deliveryPincode, weight, codAmount }
 */
exports.getCourierRates = asyncHandler(async (req, res) => {
  const { pickupPincode, deliveryPincode, weight, codAmount } = req.body;

  if (!pickupPincode || !deliveryPincode) {
    return res.status(400).json({ message: 'pickupPincode and deliveryPincode are required' });
  }

  const result = await rapidShyp.getRates({
    pickupPincode,
    deliveryPincode,
    weight: weight || 1,
    codAmount: codAmount || 0
  });

  if (!result.success) {
    return res.status(400).json({ message: result.error || 'Failed to get courier rates' });
  }

  res.json({
    success: true,
    data: result.data
  });
});

/**
 * Create shipment for an order (Forward order - COD or Online)
 * POST /api/shipping/shipments
 * Body: { orderId }
 */
exports.createShipmentForOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ message: 'orderId is required' });
  }

  const order = await Order.findById(orderId)
    .populate('seller', 'shopName address phone email userId')
    .populate('user', 'name email phone');

  if (!order) {
    return res.status(404).json({ message: 'Order not found' });
  }

  // Check if shipment already exists
  if (order.shipment?.shipmentId) {
    return res.status(400).json({ message: 'Shipment already created for this order' });
  }

  // Get seller details
  const seller = await Seller.findById(order.seller);
  if (!seller) {
    return res.status(404).json({ message: 'Seller not found' });
  }

  // Prepare pickup location (seller's address)
  const pickupLocation = {
    contactName: seller.shopName,
    pickupName: seller.shopName,
    pickupEmail: seller.email,
    pickupPhone: seller.phone,
    pickupAddress1: seller.address?.street || '',
    pickupAddress2: '',
    pinCode: seller.address?.zipCode || ''
  };

  // Prepare shipping address (customer's address)
  // Split user name into first and last name
  const userName = order.user?.name || '';
  const nameParts = userName.split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  const shippingAddress = {
    firstName: firstName,
    lastName: lastName,
    addressLine1: order.shippingAddress?.street || '',
    addressLine2: '',
    pinCode: order.shippingAddress?.zipCode || '',
    email: order.user?.email || '',
    phone: order.shippingAddress?.phone || order.user?.phone || ''
  };

  // Prepare order items
  const orderItems = order.orderItems.map(item => ({
    itemName: item.name || '',
    sku: item.sku || item.product?.toString() || '',
    description: item.name || '',
    units: item.quantity || 1,
    unitPrice: item.price || 0,
    tax: 0,
    hsn: '',
    productWeight: 0.5, // Approximate 500g per item
    imageURL: item.image || ''
  }));

  // Calculate package details
  const totalWeight = order.orderItems.reduce((sum, item) => sum + ((item.quantity || 1) * 0.5), 0.5);
  const packageDetails = {
    packageLength: 20,
    packageBreadth: 10,
    packageHeight: 5,
    packageWeight: Math.max(totalWeight, 1)
  };

  // Determine payment method
  const paymentMethod = order.paymentMethod === 'cod' ? 'COD' : 'PREPAID';

  // Create order/shipment via RapidShyp Wrapper API (creates order, shipment, label in one call)
  const shipmentResult = await rapidShyp.createWrapperOrder({
    orderId: order.orderNumber || order._id.toString(),
    orderDate: order.createdAt.toISOString().split('T')[0],
    pickupLocation,
    storeName: 'DEFAULT',
    billingIsShipping: true,
    shippingAddress,
    orderItems,
    paymentMethod,
    shippingCharges: order.shippingPrice || 0,
    totalOrderValue: order.totalPrice || 0,
    codCharges: paymentMethod === 'COD' ? (order.totalPrice || 0) : 0,
    prepaidAmount: paymentMethod === 'PREPAID' ? (order.totalPrice || 0) : 0,
    packageDetails
  });

  if (!shipmentResult.success) {
    return res.status(400).json({
      message: shipmentResult.error || 'Failed to create shipment',
      error: shipmentResult.error
    });
  }

  // Extract shipment details from response
  const responseData = shipmentResult.data;
  let shipmentDetails = {};

  // Handle different response structures from RapidShyp
  // Structure 1: response.shipment[] array (Wrapper API)
  // Structure 2: Direct shipment fields in response
  // Structure 3: Order created, need to assign AWB later
  
  if (responseData.shipment && Array.isArray(responseData.shipment) && responseData.shipment.length > 0) {
    const shipment = responseData.shipment[0];
    const statusCode = shipment.shipment_status || shipment.current_tracking_status_code || (shipment.awbGenerated || shipment.awb_generated ? 'SCB' : 'PSH');
    const statusDetails = getStatusDetails(statusCode);
    
    shipmentDetails = {
      courier: shipment.courierName || shipment.courier_name || shipment.parentCourierName || shipment.parent_courier_name || '',
      serviceName: shipment.courierName || shipment.courier_name || shipment.childCourierName || shipment.child_courier_name || '',
      awb: shipment.awb || '',
      shipmentId: shipment.shipmentId || shipment.shipment_id || responseData.orderId || responseData.order_id || '',
      trackingUrl: shipment.awb ? `https://track.rapidshyp.com/?awb=${shipment.awb}` : '',
      labelUrl: shipment.labelURL || shipment.label_url || '',
      manifestUrl: shipment.manifestURL || shipment.manifest_url || '',
      courierCost: shipment.total_freight || shipment.courier_cost || shipment.applied_weight || 0,
      status: statusDetails.code || 'SCB',
      statusDescription: statusDetails.description,
      isReturning: statusDetails.isReturning || false,
      appliedWeight: shipment.applied_weight || shipment.appliedWeight,
      deadWeight: shipment.dead_weight || shipment.deadWeight,
      packageDimensions: {
        length: shipment.length || shipment.package_length,
        breadth: shipment.breadth || shipment.package_breadth,
        height: shipment.height || shipment.package_height
      }
    };
  } else if (responseData.awb || responseData.shipment_id || responseData.shipmentId) {
    // Direct fields in response
    const statusCode = responseData.shipment_status || responseData.current_tracking_status_code || responseData.status || (responseData.awb ? 'SCB' : 'PSH');
    const statusDetails = getStatusDetails(statusCode);
    
    shipmentDetails = {
      courier: responseData.courierName || responseData.courier_name || responseData.parentCourierName || responseData.parent_courier_name || '',
      serviceName: responseData.courierName || responseData.courier_name || responseData.childCourierName || responseData.child_courier_name || '',
      awb: responseData.awb || '',
      shipmentId: responseData.shipmentId || responseData.shipment_id || responseData.orderId || responseData.order_id || '',
      trackingUrl: responseData.awb ? `https://track.rapidshyp.com/?awb=${responseData.awb}` : '',
      labelUrl: responseData.labelURL || responseData.label_url || '',
      manifestUrl: responseData.manifestURL || responseData.manifest_url || '',
      courierCost: responseData.total_freight || responseData.courier_cost || 0,
      status: statusDetails.code || (responseData.awb ? 'SCB' : 'PSH'),
      statusDescription: statusDetails.description,
      isReturning: statusDetails.isReturning || false,
      appliedWeight: responseData.applied_weight || responseData.appliedWeight,
      deadWeight: responseData.dead_weight || responseData.deadWeight,
      packageDimensions: {
        length: responseData.length || responseData.package_length,
        breadth: responseData.breadth || responseData.package_breadth,
        height: responseData.height || responseData.package_height
      }
    };
  } else if (responseData.orderCreated || responseData.order_id || responseData.orderId) {
    // Order created but shipment might need AWB assignment
    shipmentDetails = {
      shipmentId: responseData.shipmentId || responseData.shipment_id || responseData.orderId || responseData.order_id || '',
      status: 'PSH',
      statusDescription: 'Pickup Scheduled',
      isReturning: false
    };
  }

  // Update order with shipment details
  if (Object.keys(shipmentDetails).length > 0) {
    // Merge with existing shipment data if any
    order.shipment = {
      ...order.shipment,
      ...shipmentDetails
    };
    
    if (shipmentDetails.awb) {
      order.trackingNumber = shipmentDetails.awb;
      order.trackingUrl = shipmentDetails.trackingUrl || `https://track.rapidshyp.com/?awb=${shipmentDetails.awb}`;
    }
    
    // Update shipping status based on shipment status
    if (shipmentDetails.status) {
      const statusDetails = getStatusDetails(shipmentDetails.status);
      order.shippingStatus = statusDetails.shippingStatus || 'pending';
      if (order.orderStatus === 'pending' && statusDetails.internalStatus === 'processing') {
        order.orderStatus = 'processing';
      }
    } else {
      order.shippingStatus = 'pending';
    }

    // Update estimated delivery if available
    if (responseData.estimatedDelivery || responseData.estimated_delivery) {
      order.estimatedDelivery = new Date(responseData.estimatedDelivery || responseData.estimated_delivery);
    }

    // Store RapidShyp order ID for future reference
    if (responseData.orderId || responseData.order_id) {
      order.shipment.rapidShypOrderId = responseData.orderId || responseData.order_id;
    }

    await order.save();
  } else {
    // Log warning if no shipment details extracted
    console.warn('No shipment details extracted from RapidShyp response:', responseData);
  }

  res.json({
    success: true,
    message: 'Shipment created successfully',
    data: {
      shipment: order.shipment || {},
      orderId: order._id,
      rapidShypResponse: responseData
    }
  });
});

/**
 * Schedule pickup for a shipment
 * POST /api/shipping/pickups
 * Body: { orderId, pickupDate }
 */
exports.schedulePickup = asyncHandler(async (req, res) => {
  const { orderId, pickupDate } = req.body;

  if (!orderId) {
    return res.status(400).json({ message: 'orderId is required' });
  }

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(404).json({ message: 'Order not found' });
  }

  if (!order.shipment?.shipmentId) {
    return res.status(400).json({ message: 'Shipment not created for this order' });
  }

  const result = await rapidShyp.schedulePickup({
    shipmentId: order.shipment.shipmentId,
    awb: order.shipment.awb || ''
  });

  if (!result.success) {
    return res.status(400).json({ message: result.error || 'Failed to schedule pickup' });
  }

  // Update order with pickup details
  if (result.data.shipmentId) {
    order.shipment.pickupId = result.data.shipmentId;
    order.shipment.events = order.shipment.events || [];
    order.shipment.events.push({
      type: 'pickup_scheduled',
      at: new Date(),
      raw: result.data
    });

    if (pickupDate) {
      order.shipment.pickupScheduledAt = new Date(pickupDate);
    }

    await order.save();
  }

  res.json({
    success: true,
    message: 'Pickup scheduled successfully',
    data: result.data
  });
});

/**
 * Get label for an order
 * GET /api/shipping/label/:id
 */
exports.getLabelForOrder = asyncHandler(async (req, res) => {
  const orderId = req.params.id;

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(404).json({ message: 'Order not found' });
  }

  if (!order.shipment?.shipmentId) {
    return res.status(400).json({ message: 'Shipment not created for this order' });
  }

  const result = await rapidShyp.generateLabel({
    shipmentIds: [order.shipment.shipmentId]
  });

  if (!result.success) {
    return res.status(400).json({ message: result.error || 'Failed to get label' });
  }

  // Update label URL in order if available
  if (result.data?.labelData && Array.isArray(result.data.labelData) && result.data.labelData.length > 0) {
    const labelInfo = result.data.labelData[0];
    if (labelInfo.labelURL && !order.shipment.labelUrl) {
      order.shipment.labelUrl = labelInfo.labelURL;
      await order.save();
    }
  }

  res.json({
    success: true,
    data: {
      labelUrl: order.shipment.labelUrl || result.data?.labelData?.[0]?.labelURL || '',
      labelType: 'pdf',
      awb: order.shipment.awb
    }
  });
});

/**
 * Cancel shipment for an order
 * POST /api/shipping/cancel/:id
 * Body: { reason }
 */
exports.cancelShipmentForOrder = asyncHandler(async (req, res) => {
  const orderId = req.params.id;
  const { reason } = req.body;

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(404).json({ message: 'Order not found' });
  }

  if (!order.shipment?.shipmentId && !order.orderNumber) {
    return res.status(400).json({ message: 'Order does not have a RapidShyp order ID' });
  }

  // Use orderNumber as RapidShyp orderId, or fallback to order._id
  const rapidShypOrderId = order.orderNumber || order._id.toString();

  const result = await rapidShyp.cancelOrder({
    orderId: rapidShypOrderId,
    storeName: 'DEFAULT'
  });

  if (!result.success) {
    return res.status(400).json({ message: result.error || 'Failed to cancel shipment' });
  }

  // Update order status
  order.shipment = order.shipment || {};
  order.shipment.status = 'cancelled';
  order.shipment.events = order.shipment.events || [];
  order.shipment.events.push({
    type: 'shipment_cancelled',
    at: new Date(),
    raw: result.data
  });

  order.orderStatus = 'cancelled';
  order.shippingStatus = 'pending';
  order.cancelledAt = new Date();
  order.cancellationReason = reason || 'Shipment cancelled';

  await order.save();

  res.json({
    success: true,
    message: 'Shipment cancelled successfully',
    data: result.data
  });
});

/**
 * Handle NDR (Non-Delivery Report) action
 * POST /api/shipping/ndr-action
 * Body: { orderId, action, phone, address1, address2 }
 */
exports.ndrAction = asyncHandler(async (req, res) => {
  const { orderId, action, phone, address1, address2 } = req.body;

  if (!orderId || !action) {
    return res.status(400).json({ message: 'orderId and action are required' });
  }

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(404).json({ message: 'Order not found' });
  }

  if (!order.shipment?.awb) {
    return res.status(400).json({ message: 'Shipment AWB not found for this order' });
  }

  // Valid actions: RE_ATTEMPT or RETURN
  const validActions = ['RE_ATTEMPT', 'REATTEMPT', 'RETURN'];
  if (!validActions.includes(action.toUpperCase())) {
    return res.status(400).json({ message: 'Invalid action. Must be RE_ATTEMPT or RETURN' });
  }

  const result = await rapidShyp.ndrAction({
    awb: order.shipment.awb,
    action: action.toUpperCase(),
    phone,
    address1,
    address2
  });

  if (!result.success) {
    return res.status(400).json({ message: result.error || 'Failed to process NDR action' });
  }

  // Update order with NDR action
  order.shipment.events = order.shipment.events || [];
  order.shipment.events.push({
    type: `ndr_${action.toLowerCase()}`,
    at: new Date(),
    raw: result.data
  });

  // If action is RETURN, mark as RTO
  if (action.toUpperCase() === 'RETURN') {
    order.shipment.isReturning = true;
    order.shipment.status = 'rto';
    order.orderStatus = 'cancelled';
  }

  await order.save();

  res.json({
    success: true,
    message: `NDR action '${action}' processed successfully`,
    data: result.data
  });
});

/**
 * Webhook handler for RapidShyp events
 * POST /api/webhooks/rapidshyp
 */
exports.webhook = asyncHandler(async (req, res) => {
  const webhookData = req.body;

  // Log webhook data for debugging
  console.log('RapidShyp Webhook Received:', JSON.stringify(webhookData, null, 2));

  try {
    const { event_type, order_id, shipment_id, awb, status, tracking_data, seller_order_id } = webhookData;

    // Find order by shipmentId, orderId, seller_order_id, or awb
    let order = null;
    
    if (shipment_id) {
      order = await Order.findOne({ 'shipment.shipmentId': shipment_id });
    }
    
    if (!order && order_id) {
      order = await Order.findById(order_id);
    }
    
    if (!order && seller_order_id) {
      order = await Order.findOne({ orderNumber: seller_order_id });
    }
    
    if (!order && awb) {
      order = await Order.findOne({ 'shipment.awb': awb });
    }

    if (!order) {
      console.warn('Order not found for webhook:', webhookData);
      return res.status(200).json({ message: 'Order not found, but webhook received' });
    }

    // Update shipment events
    order.shipment = order.shipment || {};
    order.shipment.events = order.shipment.events || [];
    
    order.shipment.events.push({
      type: event_type || 'webhook_event',
      at: new Date(),
      raw: webhookData
    });

    // Update order status based on webhook event using status code mapper
    if (status) {
      // Handle status in different formats (string, code, object)
      let statusCode = status;
      if (typeof status === 'object' && status.code) {
        statusCode = status.code;
      } else if (typeof status === 'object' && status.status) {
        statusCode = status.status;
      }
      statusCode = String(statusCode).toUpperCase().trim();
      
      const statusDetails = getStatusDetails(statusCode);

      // Update shipment status with code and description
      order.shipment.status = statusDetails.code || statusCode;
      order.shipment.statusDescription = statusDetails.description;

      // Map to order status and shipping status
      const newOrderStatus = mapToOrderStatus(statusCode, order.orderStatus);
      const newShippingStatus = mapToShippingStatus(statusCode);

      // Only update order status if it's a valid transition
      if (newOrderStatus && newOrderStatus !== order.orderStatus) {
        // Don't downgrade from delivered to processing
        if (!(order.orderStatus === 'delivered' && newOrderStatus !== 'delivered')) {
          order.orderStatus = newOrderStatus;
        }
      }
      
      if (newShippingStatus) {
        order.shippingStatus = newShippingStatus;
      }

      // Handle RTO status
      if (isRTOStatus(statusCode)) {
        order.shipment.isReturning = true;
        // If RTO confirmed, order is effectively cancelled
        if (statusCode === 'RTO' || statusCode === 'RTO_REQ') {
          order.orderStatus = 'cancelled';
        }
      }

      // Handle delivered status
      if (statusCode === 'DEL') {
        order.deliveredAt = new Date();
        order.orderStatus = 'delivered';
        order.shippingStatus = 'delivered';
      }

      // Handle RTO delivered
      if (statusCode === 'RTO_DEL') {
        order.shipment.rtoDeliveredAt = new Date();
        order.orderStatus = 'cancelled';
        order.shippingStatus = 'delivered';
      }
    }

    // Update tracking data
    if (tracking_data) {
      if (tracking_data.tracking_url) {
        order.trackingUrl = tracking_data.tracking_url;
        order.shipment.trackingUrl = tracking_data.tracking_url;
      }
      if (tracking_data.current_status) {
        const trackingStatusCode = String(tracking_data.current_status).toUpperCase().trim();
        const trackingStatusDetails = getStatusDetails(trackingStatusCode);
        order.shipment.status = trackingStatusDetails.code || trackingStatusCode;
        order.shipment.statusDescription = trackingStatusDetails.description;
      }
      if (tracking_data.estimated_delivery) {
        order.estimatedDelivery = new Date(tracking_data.estimated_delivery);
      }
      if (tracking_data.delivered_at) {
        order.deliveredAt = new Date(tracking_data.delivered_at);
      }
    }

    // Update AWB if provided
    if (awb && !order.shipment.awb) {
      order.shipment.awb = awb;
      order.trackingNumber = awb;
      if (!order.trackingUrl) {
        order.trackingUrl = `https://track.rapidshyp.com/?awb=${awb}`;
        order.shipment.trackingUrl = order.trackingUrl;
      }
    }

    await order.save();

    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Error processing RapidShyp webhook:', error);
    res.status(500).json({ message: 'Error processing webhook', error: error.message });
  }
});

/**
 * Track order/shipment
 * POST /api/shipping/track
 * Body: { orderId, awb, contact, email }
 */
exports.trackOrder = asyncHandler(async (req, res) => {
  const { orderId, awb, contact, email } = req.body;

  if (!orderId && !awb) {
    return res.status(400).json({ message: 'Either orderId or awb is required' });
  }

  let order = null;
  if (orderId) {
    order = await Order.findById(orderId);
  }

  // Use order's AWB if available
  const trackingAwb = awb || order?.shipment?.awb;
  const sellerOrderId = orderId || order?.orderNumber;

  if (!trackingAwb && !sellerOrderId) {
    return res.status(400).json({ message: 'AWB or orderId is required for tracking' });
  }

  const result = await rapidShyp.trackOrder({
    sellerOrderId: sellerOrderId || order?._id.toString(),
    contact: contact || order?.shippingAddress?.phone || order?.user?.phone || '',
    email: email || order?.user?.email || '',
    awb: trackingAwb || ''
  });

  if (!result.success) {
    return res.status(400).json({ message: result.error || 'Failed to track order' });
  }

  // Process tracking response to extract status information
  const processedData = processTrackingResponse(result.data);

  // Update order with latest tracking info if order found
  if (order && processedData && processedData.records && processedData.records.length > 0) {
    const record = processedData.records[0];
    if (record.shipments && record.shipments.length > 0) {
      const shipment = record.shipments[0];
      
      // Update order shipment details
      if (!order.shipment) {
        order.shipment = {};
      }
      
      order.shipment.status = shipment.statusCode || order.shipment.status;
      order.shipment.statusDescription = shipment.statusDescription;
      order.shipment.courier = shipment.courierName || order.shipment.courier;
      
      if (shipment.isReturning) {
        order.shipment.isReturning = true;
      }

      // Update order status
      order.orderStatus = shipment.currentStatus || order.orderStatus;
      order.shippingStatus = shipment.shippingStatus || order.shippingStatus;

      // Update delivery dates
      if (shipment.deliveredDate) {
        order.deliveredAt = new Date(shipment.deliveredDate);
      }
      if (shipment.rtoDeliveredDate) {
        order.shipment.rtoDeliveredAt = new Date(shipment.rtoDeliveredDate);
      }
      if (shipment.estimatedDelivery) {
        order.estimatedDelivery = new Date(shipment.estimatedDelivery);
      }

      // Add tracking events
      if (shipment.trackScans && Array.isArray(shipment.trackScans)) {
        order.shipment.events = order.shipment.events || [];
        shipment.trackScans.forEach(scan => {
          order.shipment.events.push({
            type: 'tracking_scan',
            at: new Date(scan.date || scan.timestamp),
            raw: scan
          });
        });
      }

      await order.save();
    }
  }

  res.json({
    success: true,
    data: processedData || result.data,
    orderUpdated: !!order
  });
});


