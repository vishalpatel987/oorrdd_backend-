const { asyncHandler } = require('../middleware/errorMiddleware');
const Order = require('../models/Order');
const ReturnRequest = require('../models/ReturnRequest');
const sendEmail = require('../utils/sendEmail');
const Seller = require('../models/Seller');
const rapidShyp = require('../services/rapidshypService');

const isWithinDays = (date, days) => {
  const d = new Date(date).getTime();
  const now = Date.now();
  return now - d <= days * 24 * 60 * 60 * 1000;
};

// User: create return/replacement request
exports.createReturnRequest = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { orderId, type = 'return', reasonCategory, reasonText, refundDetails } = req.body;
  if (!orderId || !reasonCategory || !refundDetails) return res.status(400).json({ message: 'orderId, reasonCategory and refundDetails required' });

  const order = await Order.findById(orderId);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (String(order.user) !== String(userId)) return res.status(403).json({ message: 'Not your order' });
  if (order.orderStatus !== 'delivered') return res.status(400).json({ message: 'Return/Replacement allowed only after delivery' });
  if (!isWithinDays(order.deliveredAt || order.updatedAt, 10)) return res.status(400).json({ message: 'Return/Replacement window expired (10 days)' });

  const existing = await ReturnRequest.findOne({ user: userId, order: orderId, status: { $in: ['requested', 'approved', 'picked'] } });
  if (existing) return res.status(400).json({ message: 'A return/replacement request is already open for this order' });

  const reqDoc = await ReturnRequest.create({ user: userId, order: orderId, type, reasonCategory, reasonText, refundDetails, status: 'requested' });
  res.status(201).json(reqDoc);
});

// User: get my return requests
exports.getMyReturnRequests = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const requests = await ReturnRequest.find({ user: userId })
    .populate('order', 'orderNumber _id')
    .sort({ createdAt: -1 });
  res.json({ requests });
});

// Admin: list return requests
exports.listReturnRequests = asyncHandler(async (req, res) => {
  const { status = 'all' } = req.query;
  const q = status === 'all' ? {} : { status };
  const list = await ReturnRequest.find(q).populate('user', 'name email').populate('order');
  res.json(list);
});

/**
 * Charge Allocation Rules for Return/Replacement:
 * 
 * PRIORITY ORDER (Higher priority scenarios override lower ones):
 * 
 * 1. RTO (Return to Origin)
 *    - RTO COD: orderStatus === 'cancelled' AND paymentMethod === 'cod'
 *    - RTO Online: order.shipment?.isReturning === true
 *    - Vendor pays: 100%, Admin pays: 0%
 *    - Reason: Order refused or returned to origin
 * 
 * 2. Wrong Item (reasonCategory === 'wrong_item')
 *    - Vendor pays: 100%, Admin pays: 0%
 *    - Reason: Vendor sent wrong product
 * 
 * 3. Defective Product (reasonCategory === 'defective')
 *    - Vendor pays: 100%, Admin pays: 0%
 *    - Reason: Vendor sold defective product
 * 
 * 4. Not as Described (reasonCategory === 'not_as_described')
 *    - Vendor pays: 100%, Admin pays: 0%
 *    - Reason: Vendor misrepresented product
 * 
 * 5. Size Issue - Vendor Fault (reasonCategory === 'size_issue' AND vendor sent wrong size)
 *    - Vendor pays: 100%, Admin pays: 0%
 *    - Reason: Vendor sent wrong size/variant
 * 
 * 6. Size Issue - Customer Fault (reasonCategory === 'size_issue' AND customer ordered wrong size)
 *    - Vendor pays: 50%, Admin pays: 50%
 *    - Reason: Customer ordered wrong size, shared responsibility
 * 
 * 7. Customer Changed Mind (reasonCategory === 'other' AND contains customer changed mind keywords)
 *    - Vendor pays: 50%, Admin pays: 50%
 *    - Reason: Customer decision, shared cost
 * 
 * 8. Other (Default - reasonCategory === 'other' without customer changed mind keywords)
 *    - Vendor pays: 100%, Admin pays: 0%
 *    - Reason: Default vendor responsibility
 * 
 * Forward shipping charges are tracked but not deducted (already paid during order creation)
 * Return shipping charges are deducted based on the above rules when return is approved
 * 
 * Note: For COD orders, RTO detection also checks if order was cancelled due to COD refusal
 *       For Online orders, RTO detection checks shipment.isReturning flag
 */

// Admin: approve
exports.approveReturnRequest = asyncHandler(async (req, res) => {
  const doc = await ReturnRequest.findById(req.params.id).populate({ path: 'order', populate: [{ path: 'user', select: 'name email' }, { path: 'seller', select: 'shopName userId' }] });
  if (!doc) return res.status(404).json({ message: 'Request not found' });
  if (doc.status !== 'requested') return res.status(400).json({ message: 'Request not in requested state' });

  doc.status = 'approved';
  doc.approvedAt = new Date();

  const order = await Order.findById(doc.order);
  if (!order) return res.status(404).json({ message: 'Order not found' });

  // Get forward shipping charge from original order
  const forwardCharge = order.shipment?.courierCost || 0;
  doc.forwardShippingCharge = forwardCharge;

  // Estimate return charge as same as forward charge
  const returnCharge = forwardCharge;
    doc.returnShippingCharge = returnCharge;

  // Determine charge allocation scenario based on return reason and order status
  // Priority order: RTO > Wrong Item > Defective > Not as Described > Size Issue > Customer Changed Mind > Other
  const reasonTextLower = (doc.reasonText || '').toLowerCase();
  let scenario = 'other';
  
  // PRIORITY 1: Check for RTO (highest priority)
  // RTO COD: Order cancelled with COD payment method (refused delivery)
  if (order.orderStatus === 'cancelled' && order.paymentMethod === 'cod') {
    scenario = 'rto_cod';
  }
  // RTO Online: Order marked as returning (refused delivery or RTO in transit/delivered)
  else if (order.shipment?.isReturning === true) {
    scenario = 'rto_online';
  }
  // PRIORITY 2: Wrong Item (vendor fault)
  else if (doc.reasonCategory === 'wrong_item') {
    scenario = 'wrong_item';
  }
  // PRIORITY 3: Defective Product (vendor fault)
  else if (doc.reasonCategory === 'defective') {
    scenario = 'defective';
  }
  // PRIORITY 4: Not as Described (vendor fault)
  else if (doc.reasonCategory === 'not_as_described') {
    scenario = 'not_as_described';
  }
  // PRIORITY 5: Size Issue - Determine if vendor fault or customer fault
  else if (doc.reasonCategory === 'size_issue') {
    // Keywords indicating vendor sent wrong size
    const vendorFaultKeywords = [
      'wrong size sent', 'wrong size', 'size mismatch', 'ordered different size but got',
      'vendor sent wrong', 'wrong one sent', 'not what ordered', 'received wrong size',
      'sent wrong', 'wrong variant', 'different size received', 'size sent wrong',
      'ordered one size but got', 'wrong size delivered'
    ];
    
    // Keywords indicating customer ordered wrong size
    const customerFaultKeywords = [
      'ordered wrong', 'my mistake', 'i ordered wrong', 'wrong selection',
      'mistake in order', 'ordered different', 'wrong choice', 'my fault',
      'ordered by mistake', 'chose wrong', 'selected wrong'
    ];
    
    const hasVendorFault = vendorFaultKeywords.some(keyword => reasonTextLower.includes(keyword));
    const hasCustomerFault = customerFaultKeywords.some(keyword => reasonTextLower.includes(keyword));
    
    if (hasVendorFault) {
      scenario = 'size_issue_vendor_fault';
    } else if (hasCustomerFault) {
      scenario = 'size_issue_customer_fault';
    } else {
      // Default size issue as vendor fault (vendor should match what customer ordered)
      scenario = 'size_issue_vendor_fault';
    }
  }
  // PRIORITY 6: Customer Changed Mind (check 'other' category)
  else if (doc.reasonCategory === 'other') {
    // Customer changed mind keywords
    const customerChangedMindKeywords = [
      'changed mind', 'change mind', 'not needed', 'don\'t want', 'dont want',
      'no longer need', 'no longer want', 'don\'t need', 'dont need',
      'changed my mind', 'not required', 'not necessary', 'ordered by mistake',
      'buyer\'s remorse', 'buyers remorse', 'unwanted', 'not wanted', 'no need',
      'unnecessary', 'regret', 'cancelled', 'changed decision'
    ];
    
    const isCustomerChangedMind = customerChangedMindKeywords.some(keyword => reasonTextLower.includes(keyword));
    
    if (isCustomerChangedMind) {
      scenario = 'customer_changed_mind';
    } else {
      // Default 'other' category as vendor responsibility
      scenario = 'other';
    }
  }
  // PRIORITY 7: Default fallback
  else {
    scenario = 'other';
  }

  // Calculate charge allocation based on scenario
  let vendorCharge = 0;
  let adminCharge = 0;
  
  if (scenario === 'rto_cod' || scenario === 'rto_online') {
    // RTO (both COD and Online): Vendor pays 100%
    vendorCharge = returnCharge;
    adminCharge = 0;
  } else if (scenario === 'wrong_item') {
    // Wrong Item: Vendor pays 100%
    vendorCharge = returnCharge;
    adminCharge = 0;
  } else if (scenario === 'defective') {
    // Defective Product: Vendor pays 100%
    vendorCharge = returnCharge;
    adminCharge = 0;
  } else if (scenario === 'not_as_described') {
    // Not as Described: Vendor pays 100%
    vendorCharge = returnCharge;
    adminCharge = 0;
  } else if (scenario === 'size_issue_vendor_fault') {
    // Size Issue (Vendor Fault): Vendor pays 100%
    vendorCharge = returnCharge;
    adminCharge = 0;
  } else if (scenario === 'size_issue_customer_fault') {
    // Size Issue (Customer Fault): Admin 50% + Vendor 50%
    vendorCharge = Math.round(returnCharge * 0.5);
    adminCharge = Math.round(returnCharge * 0.5);
    // Ensure total equals returnCharge (handle rounding)
    const total = vendorCharge + adminCharge;
    if (total !== returnCharge) {
      adminCharge = returnCharge - vendorCharge; // Adjust admin to make exact
    }
  } else if (scenario === 'customer_changed_mind') {
    // Customer Changed Mind: Admin 50% + Vendor 50%
    vendorCharge = Math.round(returnCharge * 0.5);
    adminCharge = Math.round(returnCharge * 0.5);
    // Ensure total equals returnCharge (handle rounding)
    const total = vendorCharge + adminCharge;
    if (total !== returnCharge) {
      adminCharge = returnCharge - vendorCharge; // Adjust admin to make exact
    }
  } else {
    // Default (Other): Vendor pays 100%
    vendorCharge = returnCharge;
    adminCharge = 0;
  }

  // Store charge allocation details
  doc.chargeAllocation = {
    scenario,
    vendorCharge,
    adminCharge,
    totalReturnCharge: returnCharge,
    allocationApplied: false
  };

  await doc.save();

  // Deduct charges from vendor and admin wallets
  if (returnCharge > 0 && (vendorCharge > 0 || adminCharge > 0)) {
    try {
      const User = require('../models/User');
      const Seller = require('../models/Seller');

      // Deduct from vendor wallet
      let vendorDeducted = false;
      if (vendorCharge > 0 && doc.order?.seller) {
        const sellerDoc = await Seller.findById(doc.order.seller).select('userId');
        if (sellerDoc?.userId) {
          const vendorUser = await User.findById(sellerDoc.userId).select('walletBalance');
          const currentVendorBalance = vendorUser?.walletBalance || 0;
          
          // For return charges, we deduct even if it goes negative (vendor responsibility)
          // Mongoose min: 0 constraint might prevent this, so we handle it gracefully
          try {
            await User.findByIdAndUpdate(sellerDoc.userId, { 
              $inc: { walletBalance: -Math.abs(vendorCharge) } 
            });
            vendorDeducted = true;
            console.log(`Deducted ₹${vendorCharge} from vendor wallet for return request ${doc._id} (scenario: ${scenario}). Previous balance: ₹${currentVendorBalance}, New balance: ₹${Math.max(0, currentVendorBalance - vendorCharge)})`);
          } catch (deductError) {
            // If deduction fails due to negative balance constraint, log warning
            console.warn(`Could not deduct ₹${vendorCharge} from vendor wallet (balance: ₹${currentVendorBalance}). Error:`, deductError.message);
          }
        }
      }

      // Deduct from admin wallet (if any admin charge)
      // Note: Admin charges should ideally be tracked in a separate ledger or commission system
      // For now, we deduct from the first admin user's walletBalance
      let adminDeducted = false;
      if (adminCharge > 0) {
        const adminUser = await User.findOne({ role: 'admin' }).select('walletBalance').sort({ createdAt: 1 });
        if (adminUser) {
          const currentAdminBalance = adminUser.walletBalance || 0;
          // Ensure admin has enough balance (if not, just log it - charges still apply)
          if (currentAdminBalance >= adminCharge) {
            try {
              await User.findByIdAndUpdate(adminUser._id, { 
                $inc: { walletBalance: -Math.abs(adminCharge) } 
              });
              adminDeducted = true;
              console.log(`Deducted ₹${adminCharge} from admin wallet (${adminUser._id}) for return request ${doc._id} (scenario: ${scenario})`);
            } catch (deductError) {
              console.warn(`Could not deduct ₹${adminCharge} from admin wallet. Error:`, deductError.message);
            }
          } else {
            console.warn(`Admin wallet insufficient: Balance ₹${currentAdminBalance}, Required ₹${adminCharge} for return request ${doc._id}`);
          }
        } else {
          console.warn(`No admin user found to deduct ₹${adminCharge} for return request ${doc._id}`);
        }
      }

      // Mark allocation as applied (even if deduction failed, to prevent retry)
      doc.chargeAllocation.allocationApplied = true;
      await doc.save();
      
      console.log(`Charge allocation applied for return request ${doc._id}: Scenario=${scenario}, Forward=₹${forwardCharge}, Return=₹${returnCharge}, Vendor=₹${vendorCharge}, Admin=₹${adminCharge}, VendorDeducted=${vendorDeducted}, AdminDeducted=${adminDeducted}`);
    } catch (chargeError) {
      console.error('Failed to deduct charges:', chargeError);
      // Don't fail the approval if charge deduction fails, but log it
    }
  }

  // Create reverse pickup via RapidShyp for return/replacement
  try {
    const seller = await Seller.findById(order.seller);
    if (!seller) {
      console.warn(`Seller not found for order ${order._id}`);
    } else {
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

      // Prepare delivery address (seller's address - where to deliver to)
      const deliveryAddress = {
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

      // Create reverse pickup via RapidShyp
      const reversePickupResult = await rapidShyp.createReversePickup({
        orderId: order.orderNumber || order._id.toString(),
        returnRequestId: doc._id.toString(),
        pickupAddress,
        deliveryAddress,
        weight,
        reason: doc.reasonText || `${doc.reasonCategory} - ${doc.type}`,
        type: doc.type // 'return' or 'replacement'
      });

      if (reversePickupResult.success) {
        // Extract reverse pickup details from response
        const responseData = reversePickupResult.data;
        
        // Update return request with reverse pickup details
        if (responseData.shipment && Array.isArray(responseData.shipment) && responseData.shipment.length > 0) {
          const reverseShipment = responseData.shipment[0];
          doc.reverseShipmentId = reverseShipment.shipmentId || responseData.orderId;
          doc.reverseAwb = reverseShipment.awb || '';
          doc.reverseTrackingUrl = reverseShipment.labelURL ? `https://track.rapidshyp.com/?awb=${reverseShipment.awb}` : '';
          doc.pickupScheduledAt = new Date();
        } else if (responseData.awb) {
          doc.reverseShipmentId = responseData.shipmentId || responseData.orderId;
          doc.reverseAwb = responseData.awb;
          doc.reverseTrackingUrl = responseData.labelURL ? `https://track.rapidshyp.com/?awb=${responseData.awb}` : '';
          doc.pickupScheduledAt = new Date();
        }

        // Update return shipping charge if provided by RapidShyp
        if (responseData.total_freight || responseData.shipment?.[0]?.total_freight) {
          const rapidShypCost = responseData.total_freight || responseData.shipment[0].total_freight;
          doc.returnShippingCharge = rapidShypCost;
          // Recalculate charge allocation if needed
          if (doc.chargeAllocation) {
            const newReturnCharge = rapidShypCost;
            const chargeRatio = doc.chargeAllocation.totalReturnCharge > 0 ? newReturnCharge / doc.chargeAllocation.totalReturnCharge : 1;

            doc.chargeAllocation.totalReturnCharge = newReturnCharge;
            doc.chargeAllocation.vendorCharge = Math.round(doc.chargeAllocation.vendorCharge * chargeRatio);
            doc.chargeAllocation.adminCharge = Math.round(doc.chargeAllocation.adminCharge * chargeRatio);
            // Ensure total equals newReturnCharge
            const total = doc.chargeAllocation.vendorCharge + doc.chargeAllocation.adminCharge;
            if (total !== newReturnCharge) {
              doc.chargeAllocation.adminCharge = newReturnCharge - doc.chargeAllocation.vendorCharge;
            }
          }
        }

        await doc.save();

        // Update order shipment with reverse pickup info
        order.shipment = order.shipment || {};
        order.shipment.isReturning = true;
        order.shipment.events = order.shipment.events || [];
        order.shipment.events.push({
          type: 'reverse_pickup_created',
          at: new Date(),
          raw: responseData
        });
        await order.save();

        console.log(`Reverse pickup created successfully for return request ${doc._id}: AWB ${doc.reverseAwb}`);
      } else {
        console.error(`Failed to create reverse pickup for return request ${doc._id}:`, reversePickupResult.error);
        // Don't fail the approval if reverse pickup creation fails
        // Just mark order as returning
        order.shipment = order.shipment || {};
        order.shipment.isReturning = true;
        await order.save();
      }
    }
  } catch (pickupError) {
    console.error('Error creating reverse pickup via RapidShyp:', pickupError);
    // Don't fail the approval if reverse pickup creation fails
    // Just mark order as returning
    order.shipment = order.shipment || {};
    order.shipment.isReturning = true;
    await order.save();
  }

  // Notify user and vendor via email (best-effort)
  try {
    if (doc.order?.user?.email) {
      const isReturn = doc.type === 'return';
      const requestTypeLabel = isReturn ? 'Return' : 'Replacement';
      const subject = `${requestTypeLabel} Request Approved - Order ${doc.order.orderNumber || doc.order._id}`;
      
      // Get refund method details
      let refundMethodText = '';
      let refundMethodDetails = '';
      
      if (isReturn && doc.refundDetails) {
        if (doc.refundDetails.mode === 'upi') {
          refundMethodText = 'UPI';
          refundMethodDetails = `UPI ID: ${doc.refundDetails.upiId || 'Not provided'}`;
        } else if (doc.refundDetails.mode === 'bank') {
          refundMethodText = 'Bank Account';
          const bank = doc.refundDetails.bank || {};
          refundMethodDetails = `Account Holder: ${bank.accountHolderName || 'N/A'}\nBank Name: ${bank.bankName || 'N/A'}\nAccount Number: ${bank.accountNumber || 'N/A'}\nIFSC Code: ${bank.ifscCode || 'N/A'}`;
        } else if (doc.refundDetails.mode === 'wallet') {
          refundMethodText = 'Wallet Balance';
          refundMethodDetails = `Wallet ID: ${doc.refundDetails.walletId || 'Not provided'}`;
        } else {
          refundMethodText = 'Original Payment Method';
          refundMethodDetails = 'Refund will be credited to your original payment method used for this order.';
        }
      }
      
      const reversePickupText = doc.reverseAwb 
        ? `\n\nReverse Pickup Details:\n- AWB Number: ${doc.reverseAwb}${doc.reverseTrackingUrl ? `\n- Track Pickup: ${doc.reverseTrackingUrl}` : ''}`
        : '';
      
      // Main message content based on type
      let mainMessage = '';
      if (isReturn) {
        mainMessage = `Dear ${doc.order.user.name || 'Customer'},

We are pleased to inform you that your RETURN request for Order #${doc.order.orderNumber || doc.order._id} has been APPROVED.

RETURN & REFUND INFORMATION:
Your refund amount will be credited to your selected refund method within 4-5 working days after we receive and verify the returned product.

Request Details:
- Order Number: ${doc.order.orderNumber || doc.order._id}
- Request Type: RETURN
- Reason: ${doc.reasonCategory}${doc.reasonText ? ' - ' + doc.reasonText : ''}

Refund Method: ${refundMethodText}
${refundMethodDetails ? refundMethodDetails.split('\n').map(line => `- ${line}`).join('\n') : ''}

Refund Process:
1. Our team will pick up the product from your address (if reverse pickup is scheduled)
2. Once we receive and verify the product, your refund will be processed
3. The refund amount will be credited to your selected refund method (${refundMethodText}) within 4-5 working days
${reversePickupText}

Important Notes:
- Please ensure the product is in its original condition with all accessories and packaging
- Refund will be processed only after product verification
- Processing time: 4-5 working days from the date of product verification`;
      } else {
        mainMessage = `Dear ${doc.order.user.name || 'Customer'},

We are pleased to inform you that your REPLACEMENT request for Order #${doc.order.orderNumber || doc.order._id} has been APPROVED.

REPLACEMENT INFORMATION:
Your replacement product will be shipped to your registered address within 4-5 working days after we receive and verify the returned product.

Request Details:
- Order Number: ${doc.order.orderNumber || doc.order._id}
- Request Type: REPLACEMENT
- Reason: ${doc.reasonCategory}${doc.reasonText ? ' - ' + doc.reasonText : ''}

Replacement Process:
1. Our team will pick up the product from your address (if reverse pickup is scheduled)
2. Once we receive and verify the returned product, a replacement will be dispatched
3. The replacement product will be shipped to your registered address within 4-5 working days
4. You will receive tracking details once the replacement is shipped
${reversePickupText}

Important Notes:
- Please ensure the product is in its original condition with all accessories and packaging
- Replacement will be dispatched only after product verification
- Delivery time: 4-5 working days from the date of dispatch`;
      }
      
      const message = `${mainMessage}

We appreciate your patience during this process. If you have any questions or concerns, please feel free to contact our support team.

Thank you for choosing MV Store!

Best Regards,
MV Store Support Team`;
      // Build HTML content based on type
      let htmlContent = '';
      if (isReturn) {
        htmlContent = `
            <h2 style="color: #3b82f6; margin-bottom: 20px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">RETURN Request Approved ✓</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">Dear <strong>${doc.order.user.name || 'Customer'}</strong>,</p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">We are pleased to inform you that your <strong style="color: #3b82f6;">RETURN</strong> request for <strong>Order #${doc.order.orderNumber || doc.order._id}</strong> has been <strong style="color: #10b981;">APPROVED</strong>.</p>
            
            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0; border-radius: 6px;">
              <h3 style="color: #1e40af; font-size: 18px; margin-top: 0;">RETURN & REFUND INFORMATION</h3>
              <p style="color: #1e40af; font-size: 16px; font-weight: 600; margin: 10px 0;">Your refund amount will be credited to your selected refund method within <strong style="color: #dc2626;">4-5 working days</strong> after we receive and verify the returned product.</p>
            </div>

            <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
              <h3 style="color: #333; font-size: 18px; margin-top: 0; border-bottom: 2px solid #d1d5db; padding-bottom: 10px;">Request Details</h3>
              <ul style="color: #555; line-height: 2; padding-left: 20px; margin: 10px 0;">
                <li><strong>Order Number:</strong> ${doc.order.orderNumber || doc.order._id}</li>
                <li><strong>Request Type:</strong> <span style="color: #3b82f6; font-weight: bold;">RETURN</span></li>
                <li><strong>Reason:</strong> ${doc.reasonCategory}${doc.reasonText ? ' - ' + doc.reasonText : ''}</li>
              </ul>
            </div>

            ${refundMethodText ? `
            <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin: 20px 0; border-radius: 6px;">
              <h3 style="color: #92400e; font-size: 18px; margin-top: 0; border-bottom: 2px solid #fbbf24; padding-bottom: 10px;">Refund Method</h3>
              <p style="color: #78350f; font-size: 16px; font-weight: 600; margin: 10px 0;">${refundMethodText}</p>
              ${refundMethodDetails ? `<div style="color: #78350f; line-height: 1.8; margin-top: 15px;">${refundMethodDetails.split('\n').map(line => `<p style="margin: 5px 0;">• ${line}</p>`).join('')}</div>` : ''}
            </div>
            ` : ''}

            <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; border-radius: 6px;">
              <h3 style="color: #065f46; font-size: 18px; margin-top: 0; border-bottom: 2px solid #34d399; padding-bottom: 10px;">Refund Process</h3>
              <ol style="color: #065f46; line-height: 2; padding-left: 20px; margin: 10px 0;">
                <li>Our team will pick up the product from your address${doc.reverseAwb ? ' (scheduled)' : ''}</li>
                <li>Once we receive and verify the product, your refund will be processed</li>
                <li>The refund amount will be credited to your selected refund method (<strong>${refundMethodText || 'Original Payment Method'}</strong>) within <strong style="color: #dc2626;">4-5 working days</strong></li>
              </ol>
            </div>

            ${doc.reverseAwb ? `
            <div style="background-color: #e0f2fe; border-left: 4px solid #0284c7; padding: 20px; margin: 20px 0; border-radius: 6px;">
              <h3 style="color: #0c4a6e; font-size: 18px; margin-top: 0; border-bottom: 2px solid #38bdf8; padding-bottom: 10px;">Reverse Pickup Details</h3>
              <p style="color: #0c4a6e; margin: 10px 0;"><strong>AWB Number:</strong> ${doc.reverseAwb}</p>
              ${doc.reverseTrackingUrl ? `<p style="color: #0c4a6e; margin: 10px 0;"><strong>Track your pickup:</strong> <a href="${doc.reverseTrackingUrl}" style="color: #3b82f6; text-decoration: none; font-weight: bold;">${doc.reverseTrackingUrl}</a></p>` : ''}
            </div>
            ` : ''}

            <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 6px;">
              <h3 style="color: #991b1b; font-size: 16px; margin-top: 0;">Important Notes</h3>
              <ul style="color: #7f1d1d; line-height: 1.8; padding-left: 20px; margin: 10px 0;">
                <li>Please ensure the product is in its original condition with all accessories and packaging</li>
                <li>Refund will be processed only after product verification</li>
                <li>Processing time: <strong>4-5 working days</strong> from the date of product verification</li>
              </ul>
            </div>`;
      } else {
        htmlContent = `
            <h2 style="color: #3b82f6; margin-bottom: 20px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">REPLACEMENT Request Approved ✓</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">Dear <strong>${doc.order.user.name || 'Customer'}</strong>,</p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">We are pleased to inform you that your <strong style="color: #3b82f6;">REPLACEMENT</strong> request for <strong>Order #${doc.order.orderNumber || doc.order._id}</strong> has been <strong style="color: #10b981;">APPROVED</strong>.</p>
            
            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0; border-radius: 6px;">
              <h3 style="color: #1e40af; font-size: 18px; margin-top: 0;">REPLACEMENT INFORMATION</h3>
              <p style="color: #1e40af; font-size: 16px; font-weight: 600; margin: 10px 0;">Your replacement product will be shipped to your registered address within <strong style="color: #dc2626;">4-5 working days</strong> after we receive and verify the returned product.</p>
            </div>

            <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
              <h3 style="color: #333; font-size: 18px; margin-top: 0; border-bottom: 2px solid #d1d5db; padding-bottom: 10px;">Request Details</h3>
              <ul style="color: #555; line-height: 2; padding-left: 20px; margin: 10px 0;">
                <li><strong>Order Number:</strong> ${doc.order.orderNumber || doc.order._id}</li>
                <li><strong>Request Type:</strong> <span style="color: #3b82f6; font-weight: bold;">REPLACEMENT</span></li>
                <li><strong>Reason:</strong> ${doc.reasonCategory}${doc.reasonText ? ' - ' + doc.reasonText : ''}</li>
              </ul>
            </div>

            <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; border-radius: 6px;">
              <h3 style="color: #065f46; font-size: 18px; margin-top: 0; border-bottom: 2px solid #34d399; padding-bottom: 10px;">Replacement Process</h3>
              <ol style="color: #065f46; line-height: 2; padding-left: 20px; margin: 10px 0;">
                <li>Our team will pick up the product from your address${doc.reverseAwb ? ' (scheduled)' : ''}</li>
                <li>Once we receive and verify the returned product, a replacement will be dispatched</li>
                <li>The replacement product will be shipped to your registered address within <strong style="color: #dc2626;">4-5 working days</strong></li>
                <li>You will receive tracking details once the replacement is shipped</li>
              </ol>
            </div>

            ${doc.reverseAwb ? `
            <div style="background-color: #e0f2fe; border-left: 4px solid #0284c7; padding: 20px; margin: 20px 0; border-radius: 6px;">
              <h3 style="color: #0c4a6e; font-size: 18px; margin-top: 0; border-bottom: 2px solid #38bdf8; padding-bottom: 10px;">Reverse Pickup Details</h3>
              <p style="color: #0c4a6e; margin: 10px 0;"><strong>AWB Number:</strong> ${doc.reverseAwb}</p>
              ${doc.reverseTrackingUrl ? `<p style="color: #0c4a6e; margin: 10px 0;"><strong>Track your pickup:</strong> <a href="${doc.reverseTrackingUrl}" style="color: #3b82f6; text-decoration: none; font-weight: bold;">${doc.reverseTrackingUrl}</a></p>` : ''}
            </div>
            ` : ''}

            <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 6px;">
              <h3 style="color: #991b1b; font-size: 16px; margin-top: 0;">Important Notes</h3>
              <ul style="color: #7f1d1d; line-height: 1.8; padding-left: 20px; margin: 10px 0;">
                <li>Please ensure the product is in its original condition with all accessories and packaging</li>
                <li>Replacement will be dispatched only after product verification</li>
                <li>Delivery time: <strong>4-5 working days</strong> from the date of dispatch</li>
              </ul>
            </div>`;
      }
      
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            ${htmlContent}
            <p style="color: #555; font-size: 14px; line-height: 1.6; margin-top: 30px;">We appreciate your patience during this process. If you have any questions or concerns, please feel free to contact our support team.</p>
            <p style="color: #555; font-size: 14px; margin-top: 20px;">Thank you for choosing MV Store!</p>
            <p style="color: #333; font-size: 14px; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
              Best Regards,<br/>
              <strong style="color: #3b82f6;">MV Store Support Team</strong>
            </p>
          </div>
        </div>
      `;
      await sendEmail({ email: doc.order.user.email, subject, message, html });
    }
  } catch (e) {}

  try {
    // Notify vendor
    const sellerDoc = await Seller.findById(doc.order.seller).populate('userId', 'email name');
    const vendorEmail = sellerDoc?.userId?.email || sellerDoc?.email;
    if (vendorEmail) {
      const subject = `Return/Replacement approved for order ${doc.order.orderNumber || doc.order._id}`;
      const message = `A ${doc.type} request has been approved. Reason: ${doc.reasonCategory}${doc.reasonText ? ' - ' + doc.reasonText : ''}.`;
      const html = `<p>Hi ${sellerDoc.userId?.name || sellerDoc.shopName || 'Vendor'},</p><p>A <b>${doc.type}</b> request has been <b>approved</b> for order <b>${doc.order.orderNumber || doc.order._id}</b>.</p><p><b>Reason:</b> ${doc.reasonCategory}${doc.reasonText ? ' - ' + doc.reasonText : ''}</p>`;
      await sendEmail({ email: vendorEmail, subject, message, html });
    }
  } catch (e) {}

  res.json(doc);
});

// Admin: reject
exports.rejectReturnRequest = asyncHandler(async (req, res) => {
  const doc = await ReturnRequest.findById(req.params.id).populate({ path: 'order', populate: [{ path: 'user', select: 'name email' }, { path: 'seller', select: 'shopName userId' }] });
  if (!doc) return res.status(404).json({ message: 'Request not found' });
  if (doc.status !== 'requested') return res.status(400).json({ message: 'Request not in requested state' });
  doc.status = 'rejected';
  doc.rejectedAt = new Date();
  await doc.save();
  // Notify user and vendor via email (best-effort)
  try {
    if (doc.order?.user?.email) {
      const isReturn = doc.type === 'return';
      const requestTypeLabel = isReturn ? 'Return' : 'Replacement';
      const subject = `${requestTypeLabel} Request Rejected - Order ${doc.order.orderNumber || doc.order._id}`;
      
      const message = `Dear ${doc.order.user.name || 'Customer'},

We regret to inform you that your ${requestTypeLabel.toUpperCase()} request for Order #${doc.order.orderNumber || doc.order._id} has been REJECTED.

Request Details:
- Order Number: ${doc.order.orderNumber || doc.order._id}
- Request Type: ${requestTypeLabel.toUpperCase()}
- Reason for Request: ${doc.reasonCategory}${doc.reasonText ? ' - ' + doc.reasonText : ''}

Rejection Reason:
Your ${isReturn ? 'return' : 'replacement'} request has been rejected by our support team. If you believe this is an error or have additional information, please contact our support team for assistance.

If you have any questions or concerns, please feel free to contact our support team.

Thank you for your understanding.

Best Regards,
MV Store Support Team`;
      
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #ef4444; margin-bottom: 20px; border-bottom: 2px solid #ef4444; padding-bottom: 10px;">${requestTypeLabel.toUpperCase()} Request Rejected ✗</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">Dear <strong>${doc.order.user.name || 'Customer'}</strong>,</p>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">We regret to inform you that your <strong style="color: #3b82f6;">${requestTypeLabel.toUpperCase()}</strong> request for <strong>Order #${doc.order.orderNumber || doc.order._id}</strong> has been <strong style="color: #ef4444;">REJECTED</strong>.</p>
            
            <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
              <h3 style="color: #333; font-size: 18px; margin-top: 0; border-bottom: 2px solid #d1d5db; padding-bottom: 10px;">Request Details</h3>
              <ul style="color: #555; line-height: 2; padding-left: 20px; margin: 10px 0;">
                <li><strong>Order Number:</strong> ${doc.order.orderNumber || doc.order._id}</li>
                <li><strong>Request Type:</strong> <span style="color: #3b82f6; font-weight: bold;">${requestTypeLabel.toUpperCase()}</span></li>
                <li><strong>Reason for Request:</strong> ${doc.reasonCategory}${doc.reasonText ? ' - ' + doc.reasonText : ''}</li>
              </ul>
            </div>

            <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 6px;">
              <h3 style="color: #991b1b; font-size: 18px; margin-top: 0; border-bottom: 2px solid #dc2626; padding-bottom: 10px;">Rejection Notice</h3>
              <p style="color: #7f1d1d; line-height: 1.6; margin: 0;">Your ${isReturn ? 'return' : 'replacement'} request has been rejected by our support team. If you believe this is an error or have additional information, please contact our support team for assistance.</p>
            </div>

            <p style="color: #555; font-size: 14px; line-height: 1.6; margin-top: 30px;">If you have any questions or concerns, please feel free to contact our support team.</p>
            <p style="color: #555; font-size: 14px; margin-top: 20px;">Thank you for your understanding.</p>
            <p style="color: #333; font-size: 14px; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
              Best Regards,<br/>
              <strong style="color: #3b82f6;">MV Store Support Team</strong>
            </p>
          </div>
        </div>
      `;
      await sendEmail({ email: doc.order.user.email, subject, message, html });
    }
  } catch (e) {}

  try {
    const sellerDoc = await Seller.findById(doc.order.seller).populate('userId', 'email name');
    const vendorEmail = sellerDoc?.userId?.email || sellerDoc?.email;
    if (vendorEmail) {
      const subject = `Return/Replacement rejected for order ${doc.order.orderNumber || doc.order._id}`;
      const message = `A ${doc.type} request was rejected. Reason: ${doc.reasonCategory}${doc.reasonText ? ' - ' + doc.reasonText : ''}.`;
      const html = `<p>Hi ${sellerDoc.userId?.name || sellerDoc.shopName || 'Vendor'},</p><p>A <b>${doc.type}</b> request has been <b>rejected</b> for order <b>${doc.order.orderNumber || doc.order._id}</b>.</p><p><b>Reason:</b> ${doc.reasonCategory}${doc.reasonText ? ' - ' + doc.reasonText : ''}</p>`;
      await sendEmail({ email: vendorEmail, subject, message, html });
    }
  } catch (e) {}

  res.json(doc);
});

// Seller: list return requests for vendor's orders
exports.listReturnRequestsForSeller = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const seller = await Seller.findOne({ userId }).select('_id');
  if (!seller) return res.json([]);
  const orders = await Order.find({ seller: seller._id }).select('_id');
  const orderIds = orders.map(o => o._id);
  const list = await ReturnRequest.find({ order: { $in: orderIds } })
    .populate('user', 'name email')
    .populate('order');
  res.json(list);
});

// Seller: Manually create a Reverse Pickup for an order (without a return request)
exports.manualReversePickup = asyncHandler(async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ message: 'orderId is required' });

  const Order = require('../models/Order');
  const Seller = require('../models/Seller');
  const order = await Order.findById(orderId).populate('user', 'name email phone');
  if (!order) return res.status(404).json({ message: 'Order not found' });

  const seller = await Seller.findById(order.seller);
  if (!seller) return res.status(404).json({ message: 'Seller not found' });

  // Prepare addresses
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

  const deliveryAddress = {
    name: seller.shopName,
    phone: seller.phone,
    address: seller.address?.street || '',
    pincode: seller.address?.zipCode || '',
    city: seller.address?.city || '',
    state: seller.address?.state || '',
    country: seller.address?.country || 'India',
    email: seller.email || ''
  };

  const weight = order.orderItems.reduce((sum, item) => sum + (item.quantity * 0.5), 0.5);

  const reversePickupResult = await rapidShyp.createReversePickup({
    orderId: order.orderNumber || order._id.toString(),
    pickupAddress,
    deliveryAddress,
    weight,
    reason: 'Vendor manual reverse pickup',
    type: 'return'
  });

  if (!reversePickupResult.success) {
    return res.status(400).json({ message: reversePickupResult.error || 'Failed to create reverse pickup' });
  }

  const data = reversePickupResult.data || {};
  order.shipment = order.shipment || {};
  order.shipment.isReturning = true;
  order.shipment.events = order.shipment.events || [];
  order.shipment.events.push({ type: 'reverse_pickup_created', at: new Date(), raw: data });
  if (data.awb) {
    order.shipment.rtoAwb = data.awb;
    order.shipment.trackingUrl = order.shipment.trackingUrl || `https://track.rapidshyp.com/?awb=${data.awb}`;
  }
  await order.save();

  res.json({ success: true, data });
});


