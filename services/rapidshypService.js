const axios = require('axios');

/**
 * RapidShyp API Service
 * Handles all interactions with RapidShyp shipping partner
 * Documentation: API_Doc.pdf
 */
class RapidShypService {
  constructor() {
    this.baseURL = process.env.RAPIDSHYP_BASE_URL || 'https://api.rapidshyp.com/rapidshyp/apis/v1';
    this.apiKey = process.env.RAPIDSHYP_API_KEY;
    this.clientId = process.env.RAPIDSHYP_CLIENT_ID;

    if (!this.apiKey) {
      console.warn('⚠️ RapidShyp API credentials not configured. Shipping features will be limited.');
    }
  }

  /**
   * Get headers for API requests
   */
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'rapidshyp-token': this.apiKey || ''
    };
  }

  /**
   * Make API request
   */
  async makeRequest(method, endpoint, data = null) {
    try {
      if (!this.apiKey) {
        return {
          success: false,
          error: 'RapidShyp API key not configured'
        };
      }

      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: this.getHeaders(),
        timeout: 30000
      };

      if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        config.data = data;
      }

      const response = await axios(config);
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error(`RapidShyp ${method} ${endpoint} error:`, error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.response?.data?.remarks || error.message,
        data: error.response?.data
      };
    }
  }

  /**
   * 1. Pincode Serviceability API
   * Check if pincode is serviceable
   * POST /serviceability_check
   */
  async getRates({ pickupPincode, deliveryPincode, weight, codAmount = 0 }) {
    const payload = {
      Pickup_pincode: String(pickupPincode),
      Delivery_pincode: String(deliveryPincode),
      cod: codAmount > 0,
      total_order_value: codAmount || 0,
      weight: parseFloat(weight) || 1
    };

    return await this.makeRequest('POST', '/serviceability_check', payload);
  }

  /**
   * 2. Forward Wrapper API (Create Order + Shipment + Label + Manifest in one call)
   * POST /wrapper
   */
  async createWrapperOrder({
    orderId,
    orderDate,
    pickupAddressName,
    pickupLocation,
    storeName = 'DEFAULT',
    billingIsShipping = true,
    shippingAddress,
    billingAddress,
    orderItems,
    paymentMethod,
    shippingCharges = 0,
    giftWrapCharges = 0,
    transactionCharges = 0,
    totalDiscount = 0,
    totalOrderValue,
    codCharges = 0,
    prepaidAmount = 0,
    packageDetails
  }) {
    const payload = {
      orderId: String(orderId),
      orderDate: orderDate || new Date().toISOString().split('T')[0],
      storeName: String(storeName),
      billingIsShipping: Boolean(billingIsShipping),
      shippingAddress: {
        firstName: String(shippingAddress.firstName || ''),
        lastName: String(shippingAddress.lastName || ''),
        addressLine1: String(shippingAddress.addressLine1 || ''),
        addressLine2: String(shippingAddress.addressLine2 || ''),
        pinCode: String(shippingAddress.pinCode || ''),
        email: String(shippingAddress.email || ''),
        phone: String(shippingAddress.phone || '')
      },
      orderItems: Array.isArray(orderItems) ? orderItems.map(item => ({
        itemName: String(item.itemName || ''),
        sku: String(item.sku || ''),
        description: String(item.description || ''),
        units: parseInt(item.units) || 1,
        unitPrice: parseFloat(item.unitPrice) || 0,
        tax: parseFloat(item.tax) || 0,
        hsn: String(item.hsn || ''),
        productLength: item.productLength ? parseFloat(item.productLength) : undefined,
        productBreadth: item.productBreadth ? parseFloat(item.productBreadth) : undefined,
        productHeight: item.productHeight ? parseFloat(item.productHeight) : undefined,
        productWeight: item.productWeight ? parseFloat(item.productWeight) : undefined,
        brand: String(item.brand || ''),
        imageURL: String(item.imageURL || ''),
        isFragile: Boolean(item.isFragile || false),
        isPersonalisable: Boolean(item.isPersonalisable || false)
      })) : [],
      paymentMethod: String(paymentMethod || 'PREPAID').toUpperCase(),
      shippingCharges: parseFloat(shippingCharges) || 0,
      giftWrapCharges: parseFloat(giftWrapCharges) || 0,
      transactionCharges: parseFloat(transactionCharges) || 0,
      totalDiscount: parseFloat(totalDiscount) || 0,
      totalOrderValue: parseFloat(totalOrderValue) || 0,
      codCharges: parseFloat(codCharges) || 0,
      prepaidAmount: parseFloat(prepaidAmount) || 0,
      packageDetails: {
        packageLength: parseFloat(packageDetails?.packageLength) || 20,
        packageBreadth: parseFloat(packageDetails?.packageBreadth) || 10,
        packageHeight: parseFloat(packageDetails?.packageHeight) || 5,
        packageWeight: parseFloat(packageDetails?.packageWeight) || 1
      }
    };

    // Add pickup location if provided
    if (pickupLocation) {
      payload.pickupLocation = {
        contactName: String(pickupLocation.contactName || ''),
        pickupName: String(pickupLocation.pickupName || ''),
        pickupEmail: String(pickupLocation.pickupEmail || ''),
        pickupPhone: String(pickupLocation.pickupPhone || ''),
        pickupAddress1: String(pickupLocation.pickupAddress1 || ''),
        pickupAddress2: String(pickupLocation.pickupAddress2 || ''),
        pinCode: String(pickupLocation.pinCode || '')
      };
    } else if (pickupAddressName) {
      payload.pickupAddressName = String(pickupAddressName);
    }

    // Add billing address if different from shipping
    if (!billingIsShipping && billingAddress) {
      payload.billingAddress = {
        firstName: String(billingAddress.firstName || ''),
        lastName: String(billingAddress.lastName || ''),
        addressLine1: String(billingAddress.addressLine1 || ''),
        addressLine2: String(billingAddress.addressLine2 || ''),
        pinCode: String(billingAddress.pinCode || ''),
        email: String(billingAddress.email || ''),
        phone: String(billingAddress.phone || '')
      };
    }

    return await this.makeRequest('POST', '/wrapper', payload);
  }

  /**
   * 3. Forward Create Order API
   * POST /create_order
   */
  async createOrder({
    orderId,
    orderDate,
    pickupAddressName,
    pickupLocation,
    storeName = 'DEFAULT',
    billingIsShipping = true,
    shippingAddress,
    billingAddress,
    orderItems,
    paymentMethod,
    shippingCharges = 0,
    giftWrapCharges = 0,
    transactionCharges = 0,
    totalDiscount = 0,
    totalOrderValue,
    codCharges = 0,
    prepaidAmount = 0,
    packageDetails
  }) {
    const payload = {
      orderId: String(orderId),
      orderDate: orderDate || new Date().toISOString().split('T')[0],
      storeName: String(storeName),
      billingIsShipping: Boolean(billingIsShipping),
      shippingAddress: {
        firstName: String(shippingAddress.firstName || ''),
        lastName: String(shippingAddress.lastName || ''),
        addressLine1: String(shippingAddress.addressLine1 || ''),
        addressLine2: String(shippingAddress.addressLine2 || ''),
        pinCode: String(shippingAddress.pinCode || ''),
        email: String(shippingAddress.email || ''),
        phone: String(shippingAddress.phone || '')
      },
      orderItems: Array.isArray(orderItems) ? orderItems.map(item => ({
        itemName: String(item.itemName || ''),
        sku: String(item.sku || ''),
        description: String(item.description || ''),
        units: parseInt(item.units) || 1,
        unitPrice: parseFloat(item.unitPrice) || 0,
        tax: parseFloat(item.tax) || 0,
        hsn: String(item.hsn || ''),
        productLength: item.productLength ? parseFloat(item.productLength) : undefined,
        productBreadth: item.productBreadth ? parseFloat(item.productBreadth) : undefined,
        productHeight: item.productHeight ? parseFloat(item.productHeight) : undefined,
        productWeight: item.productWeight ? parseFloat(item.productWeight) : undefined,
        brand: String(item.brand || ''),
        imageURL: String(item.imageURL || ''),
        isFragile: Boolean(item.isFragile || false),
        isPersonalisable: Boolean(item.isPersonalisable || false)
      })) : [],
      paymentMethod: String(paymentMethod || 'PREPAID').toUpperCase(),
      shippingCharges: parseFloat(shippingCharges) || 0,
      giftWrapCharges: parseFloat(giftWrapCharges) || 0,
      transactionCharges: parseFloat(transactionCharges) || 0,
      totalDiscount: parseFloat(totalDiscount) || 0,
      totalOrderValue: parseFloat(totalOrderValue) || 0,
      codCharges: parseFloat(codCharges) || 0,
      prepaidAmount: parseFloat(prepaidAmount) || 0,
      packageDetails: {
        packageLength: parseFloat(packageDetails?.packageLength) || 20,
        packageBreadth: parseFloat(packageDetails?.packageBreadth) || 10,
        packageHeight: parseFloat(packageDetails?.packageHeight) || 5,
        packageWeight: parseFloat(packageDetails?.packageWeight) || 1
      }
    };

    // Add pickup location if provided
    if (pickupLocation) {
      payload.pickupLocation = {
        contactName: String(pickupLocation.contactName || ''),
        pickupName: String(pickupLocation.pickupName || ''),
        pickupEmail: String(pickupLocation.pickupEmail || ''),
        pickupPhone: String(pickupLocation.pickupPhone || ''),
        pickupAddress1: String(pickupLocation.pickupAddress1 || ''),
        pickupAddress2: String(pickupLocation.pickupAddress2 || ''),
        pinCode: String(pickupLocation.pinCode || '')
      };
    } else if (pickupAddressName) {
      payload.pickupAddressName = String(pickupAddressName);
    }

    // Add billing address if different from shipping
    if (!billingIsShipping && billingAddress) {
      payload.billingAddress = {
        firstName: String(billingAddress.firstName || ''),
        lastName: String(billingAddress.lastName || ''),
        addressLine1: String(billingAddress.addressLine1 || ''),
        addressLine2: String(billingAddress.addressLine2 || ''),
        pinCode: String(billingAddress.pinCode || ''),
        email: String(billingAddress.email || ''),
        phone: String(billingAddress.phone || '')
      };
    }

    return await this.makeRequest('POST', '/create_order', payload);
  }

  /**
   * 4. Forward Update Order API
   * POST /order_update
   */
  async updateOrder({
    orderId,
    storeName = 'DEFAULT',
    pickupAddressName,
    shippingAddress,
    billingAddress,
    billingIsShipping,
    paymentMethod,
    packageDetails
  }) {
    const payload = {
      orderId: String(orderId),
      store_name: String(storeName)
    };

    if (pickupAddressName) {
      payload.pickupAddressName = String(pickupAddressName);
    }

    if (shippingAddress) {
      payload.shippingAddress = {
        firstName: String(shippingAddress.firstName || ''),
        lastName: String(shippingAddress.lastName || ''),
        addressLine1: String(shippingAddress.addressLine1 || ''),
        addressLine2: String(shippingAddress.addressLine2 || ''),
        pinCode: String(shippingAddress.pinCode || ''),
        email: String(shippingAddress.email || ''),
        phone: String(shippingAddress.phone || '')
      };
    }

    if (billingAddress) {
      payload.billingAddress = {
        firstName: String(billingAddress.firstName || ''),
        lastName: String(billingAddress.lastName || ''),
        addressLine1: String(billingAddress.addressLine1 || ''),
        addressLine2: String(billingAddress.addressLine2 || ''),
        pinCode: String(billingAddress.pinCode || ''),
        email: String(billingAddress.email || ''),
        phone: String(billingAddress.phone || '')
      };
    }

    if (typeof billingIsShipping === 'boolean') {
      payload.billingIsShipping = billingIsShipping;
    }

    if (paymentMethod) {
      payload.paymentMethod = String(paymentMethod).toUpperCase();
    }

    if (packageDetails) {
      payload.packageDetails = {
        packageLength: parseFloat(packageDetails.packageLength) || 20,
        packageBreadth: parseFloat(packageDetails.packageBreadth) || 10,
        packageHeight: parseFloat(packageDetails.packageHeight) || 5,
        packageWeight: parseFloat(packageDetails.packageWeight) || 1
      };
    }

    return await this.makeRequest('POST', '/order_update', payload);
  }

  /**
   * 5. AWB Assignment API
   * POST /assign_awb
   */
  async assignAWB({ shipmentId, courierCode = '' }) {
    const payload = {
      shipment_id: String(shipmentId),
      courier_code: String(courierCode || '')
    };

    return await this.makeRequest('POST', '/assign_awb', payload);
  }

  /**
   * 6. Schedule Pickup API
   * POST /schedule_pickup
   */
  async schedulePickup({ shipmentId, awb = '' }) {
    const payload = {
      shipment_id: String(shipmentId)
    };

    if (awb) {
      payload.awb = String(awb);
    }

    return await this.makeRequest('POST', '/schedule_pickup', payload);
  }

  /**
   * 7. De-allocate Shipment API
   * POST /de_allocate_shipment
   */
  async deallocateShipment({ orderId, shipmentId }) {
    const payload = {
      orderId: String(orderId),
      shipmentId: String(shipmentId)
    };

    return await this.makeRequest('POST', '/de_allocate_shipment', payload);
  }

  /**
   * 8. Cancel Order API
   * POST /cancel_order
   */
  async cancelOrder({ orderId, storeName = 'DEFAULT' }) {
    const payload = {
      orderId: String(orderId),
      storeName: String(storeName)
    };

    return await this.makeRequest('POST', '/cancel_order', payload);
  }

  /**
   * 9. Label PDF Generation API
   * POST /generate_label
   */
  async generateLabel({ shipmentIds }) {
    const payload = {
      shipmentId: Array.isArray(shipmentIds) ? shipmentIds : [String(shipmentIds)]
    };

    return await this.makeRequest('POST', '/generate_label', payload);
  }

  /**
   * 10. Create Pickup Location API
   * POST /create/pickup_location
   */
  async createPickupLocation({
    addressName,
    contactName,
    contactNumber,
    email,
    addressLine,
    addressLine2,
    pincode,
    gstin,
    dropshipLocation = false,
    useAltRtoAddress = false,
    rtoAddress,
    createRtoAddress
  }) {
    const payload = {
      address_name: String(addressName),
      contact_name: String(contactName),
      contact_number: String(contactNumber),
      email: String(email || ''),
      address_line: String(addressLine),
      address_line2: String(addressLine2 || ''),
      pincode: String(pincode),
      gstin: String(gstin || ''),
      dropship_location: Boolean(dropshipLocation),
      use_alt_rto_address: Boolean(useAltRtoAddress)
    };

    if (rtoAddress) {
      payload.rto_address = String(rtoAddress);
    }

    if (createRtoAddress) {
      payload.create_rto_address = {
        rto_address_name: String(createRtoAddress.rtoAddressName || ''),
        rto_contact_name: String(createRtoAddress.rtoContactName || ''),
        rto_contact_number: String(createRtoAddress.rtoContactNumber || ''),
        rto_email: String(createRtoAddress.rtoEmail || ''),
        rto_address_line: String(createRtoAddress.rtoAddressLine || ''),
        rto_address_line2: String(createRtoAddress.rtoAddressLine2 || ''),
        rto_pincode: String(createRtoAddress.rtoPincode || ''),
        rto_gstin: String(createRtoAddress.rtoGstin || '')
      };
    }

    return await this.makeRequest('POST', '/create/pickup_location', payload);
  }

  /**
   * 11. Action NDR API (Non-Delivery Report)
   * POST /ndr/action
   */
  async ndrAction({ awb, action, phone, address1, address2 }) {
    const payload = {
      awb: String(awb),
      action: String(action).toUpperCase() // RE_ATTEMPT or RETURN
    };

    if (action === 'RE_ATTEMPT' || action === 'REATTEMPT') {
      if (phone) {
        payload.phone = String(phone);
      }
      if (address1) {
        payload.address1 = String(address1);
      }
      if (address2) {
        payload.address2 = String(address2);
      }
    }

    return await this.makeRequest('POST', '/ndr/action', payload);
  }

  /**
   * 12. Track Order API
   * POST /track_order
   */
  async trackOrder({ sellerOrderId, contact, email, awb }) {
    const payload = {};

    if (sellerOrderId) {
      payload.seller_order_id = String(sellerOrderId);
    }

    if (contact) {
      payload.contact = String(contact);
    }

    if (email) {
      payload.email = String(email);
    }

    if (awb) {
      payload.awb = String(awb);
    }

    return await this.makeRequest('POST', '/track_order', payload);
  }

  /**
   * Helper: Create reverse pickup (for returns/replacements)
   * Uses create_order API with reverse logic
   */
  async createReversePickup({
    orderId,
    returnRequestId,
    pickupAddress, // Customer address (where to pick from) - This becomes PICKUP location
    deliveryAddress, // Seller address (where to deliver to) - This becomes SHIPPING address
    weight,
    reason,
    type = 'return'
  }) {
    // Split delivery address name into firstName and lastName for shipping address
    const deliveryNameParts = String(deliveryAddress.name || '').trim().split(' ');
    const deliveryFirstName = deliveryNameParts[0] || '';
    const deliveryLastName = deliveryNameParts.slice(1).join(' ') || '';

    // Split pickup address name into firstName and lastName for pickup location
    const pickupNameParts = String(pickupAddress.name || '').trim().split(' ');
    const pickupFirstName = pickupNameParts[0] || '';
    const pickupLastName = pickupNameParts.slice(1).join(' ') || '';

    const payload = {
      orderId: String(returnRequestId || `RET_${orderId}_${Date.now()}`),
      orderDate: new Date().toISOString().split('T')[0],
      storeName: 'DEFAULT',
      billingIsShipping: true,
      // SHIPPING ADDRESS = Seller's address (where to deliver/return the product to)
      shippingAddress: {
        firstName: deliveryFirstName,
        lastName: deliveryLastName,
        addressLine1: String(deliveryAddress.address || ''),
        addressLine2: deliveryAddress.addressLine2 || '',
        pinCode: String(deliveryAddress.pincode || ''),
        city: String(deliveryAddress.city || ''),
        state: String(deliveryAddress.state || ''),
        country: String(deliveryAddress.country || 'India'),
        email: String(deliveryAddress.email || ''),
        phone: String(deliveryAddress.phone || '')
      },
      orderItems: [{
        itemName: `${type === 'return' ? 'Return' : 'Replacement'} - ${reason || ''}`,
        sku: String(returnRequestId || ''),
        description: String(reason || ''),
        units: 1,
        unitPrice: 0,
        tax: 0,
        productWeight: parseFloat(weight) || 1
      }],
      paymentMethod: 'PREPAID',
      shippingCharges: 0,
      totalOrderValue: 0,
      packageDetails: {
        packageLength: 20,
        packageBreadth: 10,
        packageHeight: 5,
        packageWeight: Math.max(parseFloat(weight) || 1, 0.5)
      },
      // PICKUP LOCATION = Customer's address (where to pick the product from)
      pickupLocation: {
        contactName: pickupFirstName,
        pickupName: `Reverse Pickup - ${orderId}`,
        pickupLastName: pickupLastName,
        pickupEmail: String(pickupAddress.email || ''),
        pickupPhone: String(pickupAddress.phone || ''),
        pickupAddress1: String(pickupAddress.address || ''),
        pickupAddress2: pickupAddress.addressLine2 || '',
        pinCode: String(pickupAddress.pincode || ''),
        city: String(pickupAddress.city || ''),
        state: String(pickupAddress.state || ''),
        country: String(pickupAddress.country || 'India')
      }
    };

    return await this.makeRequest('POST', '/create_order', payload);
  }

  /**
   * Helper: Create RTO (Return to Origin)
   * First cancels the order, then creates RTO shipment if cancellation succeeds
   */
  async createRTO({
    orderId,
    originalAwb,
    pickupAddress, // Customer address (where to pick from)
    returnAddress, // Seller address (where to return to)
    weight,
    reason
  }) {
    // First try to cancel the original order in RapidShyp
    const cancelResult = await this.cancelOrder({ 
      orderId: String(orderId),
      storeName: 'DEFAULT'
    });
    
    // Even if cancellation fails, we can still try to create RTO shipment
    // as RapidShyp might handle RTO automatically
    // But if cancellation succeeds, create explicit RTO shipment
    
    if (cancelResult.success || originalAwb) {
      // Split return address name into firstName and lastName for shipping address
      const returnNameParts = String(returnAddress.name || '').trim().split(' ');
      const returnFirstName = returnNameParts[0] || '';
      const returnLastName = returnNameParts.slice(1).join(' ') || '';

      // Split pickup address name into firstName and lastName for pickup location
      const pickupNameParts = String(pickupAddress.name || '').trim().split(' ');
      const pickupFirstName = pickupNameParts[0] || '';
      const pickupLastName = pickupNameParts.slice(1).join(' ') || '';

      // Create RTO shipment using create_order API
      // For RTO: pickup from customer, deliver to seller
      const rtoPayload = {
        orderId: String(`RTO_${orderId}_${Date.now()}`),
        orderDate: new Date().toISOString().split('T')[0],
        storeName: 'DEFAULT',
        billingIsShipping: true,
        // SHIPPING ADDRESS = Seller's address (where to return the product to)
        shippingAddress: {
          firstName: returnFirstName,
          lastName: returnLastName,
          addressLine1: String(returnAddress.address || ''),
          addressLine2: returnAddress.addressLine2 || '',
          pinCode: String(returnAddress.pincode || ''),
          city: String(returnAddress.city || ''),
          state: String(returnAddress.state || ''),
          country: String(returnAddress.country || 'India'),
          email: String(returnAddress.email || ''),
          phone: String(returnAddress.phone || '')
        },
        orderItems: [{
          itemName: `RTO - ${reason || 'Order cancelled'}`,
          sku: String(orderId),
          description: String(reason || 'Return to Origin'),
          units: 1,
          unitPrice: 0,
          tax: 0,
          productWeight: parseFloat(weight) || 1
        }],
        paymentMethod: 'PREPAID',
        shippingCharges: 0,
        totalOrderValue: 0,
        packageDetails: {
          packageLength: 20,
          packageBreadth: 10,
          packageHeight: 5,
          packageWeight: Math.max(parseFloat(weight) || 1, 0.5)
        },
        // PICKUP LOCATION = Customer's address (where to pick the product from)
        pickupLocation: {
          contactName: pickupFirstName,
          pickupName: `RTO Pickup - ${orderId}`,
          pickupLastName: pickupLastName,
          pickupEmail: String(pickupAddress.email || ''),
          pickupPhone: String(pickupAddress.phone || ''),
          pickupAddress1: String(pickupAddress.address || ''),
          pickupAddress2: pickupAddress.addressLine2 || '',
          pinCode: String(pickupAddress.pincode || ''),
          city: String(pickupAddress.city || ''),
          state: String(pickupAddress.state || ''),
          country: String(pickupAddress.country || 'India')
        }
      };

      const rtoShipmentResult = await this.makeRequest('POST', '/create_order', rtoPayload);
      
      // If RTO shipment creation succeeds, return success
      // Otherwise, return cancellation result (at least order is cancelled)
      if (rtoShipmentResult.success) {
        return {
          success: true,
          data: {
            ...rtoShipmentResult.data,
            originalOrderCancelled: cancelResult.success,
            originalAwb: originalAwb
          }
        };
      }
    }

    // Return cancellation result (order cancelled, even if RTO shipment creation failed)
    return {
      success: cancelResult.success,
      data: {
        orderCancelled: cancelResult.success,
        rtoShipmentCreated: false,
        message: cancelResult.success ? 'Order cancelled. RTO shipment creation may need manual handling.' : cancelResult.error
      },
      error: cancelResult.success ? null : cancelResult.error
    };
  }
}

module.exports = new RapidShypService();

