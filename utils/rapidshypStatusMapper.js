/**
 * RapidShyp Status Code Mapper
 * Maps RapidShyp tracking status codes to human-readable descriptions and internal statuses
 * Based on API_Doc.pdf pages 33-34
 */

const STATUS_MAP = {
  // Booking & Pickup Statuses
  'SCB': { description: 'Shipment Booked', internalStatus: 'created', shippingStatus: 'pending' },
  'PSH': { description: 'Pickup Scheduled', internalStatus: 'processing', shippingStatus: 'pending' },
  'OFP': { description: 'Out for Pickup', internalStatus: 'processing', shippingStatus: 'pending' },
  'PUE': { description: 'Pick up Exception', internalStatus: 'processing', shippingStatus: 'pending' },
  'PCN': { description: 'Pickup Cancelled', internalStatus: 'cancelled', shippingStatus: 'cancelled' },
  'PUC': { description: 'Pickup Completed', internalStatus: 'processing', shippingStatus: 'shipped' },
  
  // Shipment Statuses
  'SPD': { description: 'Shipped/Dispatched', internalStatus: 'processing', shippingStatus: 'shipped' },
  'INT': { description: 'In Transit', internalStatus: 'processing', shippingStatus: 'shipped' },
  'RAD': { description: 'Reached at Destination', internalStatus: 'processing', shippingStatus: 'shipped' },
  'DED': { description: 'Delivery Delayed', internalStatus: 'processing', shippingStatus: 'shipped' },
  'OFD': { description: 'Out for Delivery', internalStatus: 'processing', shippingStatus: 'shipped' },
  'DEL': { description: 'Delivered', internalStatus: 'delivered', shippingStatus: 'delivered' },
  'UND': { description: 'Undelivered', internalStatus: 'processing', shippingStatus: 'shipped' },
  
  // RTO Statuses
  'RTO_REQ': { description: 'RTO Requested', internalStatus: 'cancelled', shippingStatus: 'shipped', isReturning: true },
  'RTO': { description: 'RTO Confirmed', internalStatus: 'cancelled', shippingStatus: 'shipped', isReturning: true },
  'RTO_INT': { description: 'RTO In Transit', internalStatus: 'cancelled', shippingStatus: 'shipped', isReturning: true },
  'RTO_RAD': { description: 'RTO - Reached at Destination', internalStatus: 'cancelled', shippingStatus: 'shipped', isReturning: true },
  'RTO_OFD': { description: 'RTO Out for Delivery', internalStatus: 'cancelled', shippingStatus: 'shipped', isReturning: true },
  'RTO_DEL': { description: 'RTO Delivered', internalStatus: 'cancelled', shippingStatus: 'delivered', isReturning: true },
  'RTO_UND': { description: 'RTO Undelivered', internalStatus: 'cancelled', shippingStatus: 'shipped', isReturning: true },
  
  // Exception Statuses
  'CAN': { description: 'Shipment Cancelled', internalStatus: 'cancelled', shippingStatus: 'cancelled' },
  'ONH': { description: 'Shipment On Hold', internalStatus: 'processing', shippingStatus: 'shipped' },
  'LST': { description: 'Shipment Lost', internalStatus: 'cancelled', shippingStatus: 'cancelled' },
  'DMG': { description: 'Shipment Damaged', internalStatus: 'processing', shippingStatus: 'shipped' },
  'MSR': { description: 'Shipment Misrouted', internalStatus: 'processing', shippingStatus: 'shipped' },
  'DPO': { description: 'Shipment Disposed-Off', internalStatus: 'cancelled', shippingStatus: 'cancelled' }
};

/**
 * Get status details from RapidShyp status code
 * @param {string} statusCode - RapidShyp status code (e.g., 'DEL', 'INT', 'RTO')
 * @returns {Object} Status details with description, internalStatus, shippingStatus, isReturning
 */
function getStatusDetails(statusCode) {
  if (!statusCode) {
    return {
      description: 'Unknown',
      internalStatus: 'pending',
      shippingStatus: 'pending',
      isReturning: false
    };
  }

  const code = String(statusCode).toUpperCase();
  const status = STATUS_MAP[code];

  if (status) {
    return {
      ...status,
      code: code,
      isReturning: status.isReturning || false
    };
  }

  // Default for unknown codes
  return {
    description: `Status: ${code}`,
    internalStatus: 'processing',
    shippingStatus: 'shipped',
    isReturning: false,
    code: code
  };
}

/**
 * Map RapidShyp shipment status to order status
 * @param {string} statusCode - RapidShyp status code
 * @param {string} currentOrderStatus - Current order status
 * @returns {string} Updated order status
 */
function mapToOrderStatus(statusCode, currentOrderStatus = 'pending') {
  const status = getStatusDetails(statusCode);
  return status.internalStatus;
}

/**
 * Map RapidShyp shipment status to shipping status
 * @param {string} statusCode - RapidShyp status code
 * @returns {string} Shipping status
 */
function mapToShippingStatus(statusCode) {
  const status = getStatusDetails(statusCode);
  return status.shippingStatus;
}

/**
 * Check if status indicates RTO (Return to Origin)
 * @param {string} statusCode - RapidShyp status code
 * @returns {boolean} True if RTO
 */
function isRTOStatus(statusCode) {
  const status = getStatusDetails(statusCode);
  return status.isReturning || String(statusCode).toUpperCase().startsWith('RTO');
}

/**
 * Get human-readable status description
 * @param {string} statusCode - RapidShyp status code
 * @returns {string} Human-readable description
 */
function getStatusDescription(statusCode) {
  const status = getStatusDetails(statusCode);
  return status.description;
}

/**
 * Process RapidShyp tracking response and extract status
 * @param {Object} trackingData - RapidShyp tracking API response
 * @returns {Object} Processed status information
 */
function processTrackingResponse(trackingData) {
  if (!trackingData || !trackingData.records || !Array.isArray(trackingData.records)) {
    return null;
  }

  const processedRecords = trackingData.records.map(record => {
    if (!record.shipment_details || !Array.isArray(record.shipment_details)) {
      return null;
    }

    const shipments = record.shipment_details.map(shipment => {
      const statusCode = shipment.current_tracking_status_code || shipment.shipment_status;
      const statusDetails = getStatusDetails(statusCode);

      return {
        shipmentId: shipment.shipment_id,
        awb: shipment.awb,
        statusCode: statusCode,
        statusDescription: statusDetails.description,
        courierName: shipment.courier_name || shipment.child_courier_name,
        currentStatus: statusDetails.internalStatus,
        shippingStatus: statusDetails.shippingStatus,
        isReturning: statusDetails.isReturning,
        estimatedDelivery: shipment.current_courier_edd,
        deliveredDate: shipment.delivered_date || record.delivered_date,
        rtoDeliveredDate: shipment.rto_delivered_date,
        trackScans: shipment.track_scans || [],
        ndrReason: shipment.latest_ndr_reason_desc,
        ndrCode: shipment.latest_ndr_reason_code
      };
    });

    return {
      orderId: record.seller_order_id,
      orderDate: record.creation_date,
      paymentMethod: record.payment_method,
      totalOrderValue: record.total_order_value,
      shipments: shipments
    };
  });

  return {
    success: trackingData.success || true,
    records: processedRecords.filter(r => r !== null)
  };
}

module.exports = {
  STATUS_MAP,
  getStatusDetails,
  mapToOrderStatus,
  mapToShippingStatus,
  isRTOStatus,
  getStatusDescription,
  processTrackingResponse
};

