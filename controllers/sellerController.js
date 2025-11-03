const Seller = require('../models/Seller');
const User = require('../models/User');
const Product = require('../models/Product');
const cloudinary = require('../utils/cloudinary');
const Category = require('../models/Category');
const mongoose = require('mongoose');

// Register a new seller (vendor request)
exports.register = async (req, res) => {
  try {
    console.log('Registration request body:', req.body);
    console.log('Registration request files:', req.files);
    
    // Extract data from FormData
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      businessName,
      businessType,
      businessDescription,
      website,
      address,
      city,
      state,
      zipCode,
      country,
      taxId,
      businessLicense,
      categories
    } = req.body;

    // Parse categories if it's a string
    let parsedCategories = [];
    if (categories) {
      try {
        parsedCategories = typeof categories === 'string' ? JSON.parse(categories) : categories;
      } catch (e) {
        parsedCategories = [];
      }
    }

    // Validate required fields
    if (!email || !password || !businessName) {
      return res.status(400).json({ 
        message: 'Missing required fields',
        required: ['email', 'password', 'businessName'],
        received: { 
          email: !!email, 
          password: !!password, 
          businessName: !!businessName,
          firstName: !!firstName,
          lastName: !!lastName
        }
      });
    }

    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'A user with this email already exists.' });
    }

    // Create new user with role 'seller'
    user = await User.create({
      name: (firstName && lastName) ? `${firstName} ${lastName}` : businessName,
      email,
      password,
      role: 'seller',
      phone
    });

    // Handle document uploads
    const documents = [];
    if (req.files) {
      for (const fieldName in req.files) {
        const file = req.files[fieldName][0];
        if (file) {
          try {
            const uploadResult = await new Promise((resolve, reject) => {
              const stream = cloudinary.uploader.upload_stream({ 
                folder: 'vendor-documents',
                resource_type: 'auto'
              }, (error, result) => {
                if (error) return reject(error);
                resolve(result);
              });
              stream.end(file.buffer);
            });
            
            documents.push({
              name: getDocumentName(fieldName),
              url: uploadResult.secure_url,
              type: fieldName,
              uploadedAt: new Date()
            });
          } catch (uploadError) {
            console.error('Document upload failed:', uploadError);
            // Continue with other documents even if one fails
          }
        }
      }
    }

    // Map country code to full name
    const countryMap = {
      'IN': 'India',
      'US': 'India', // For backward compatibility
      'India': 'India'
    };
    const mappedCountry = countryMap[country] || 'India';

    // Create seller request
    const seller = new Seller({
      userId: user._id, // associate with new user
      email,
      phone,
      shopName: businessName,
      description: businessDescription,
      address: {
        street: address,
        city,
        state,
        zipCode,
        country: mappedCountry
      },
      businessInfo: {
        businessType,
        taxId,
        businessLicense
      },
      documents: documents,
      categories: [], // You can map category names to IDs if needed
      isApproved: false // Pending approval
    });
    await seller.save();
    res.status(201).json({ message: 'Vendor registration request submitted. Awaiting admin approval.' });
  } catch (error) {
    console.error('Seller registration error:', error);
    res.status(500).json({ message: 'Server error', error: error.message, stack: error.stack });
  }
};

// Helper function to get document name
const getDocumentName = (fieldName) => {
  const nameMap = {
    'businessLicenseFile': 'Business License',
    'taxCertificateFile': 'Tax Certificate',
    'bankStatementFile': 'Bank Statement'
  };
  return nameMap[fieldName] || fieldName;
};

// Placeholder: Get seller dashboard
exports.getDashboard = (req, res) => {
  res.json({ message: 'Get seller dashboard' });
};

// Get all products for the current seller
exports.getProducts = async (req, res) => {
  try {
    const seller = await Seller.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });
    const products = await Product.find({ seller: seller._id });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Create a new product for the current seller
exports.createProduct = async (req, res) => {
  try {
    const seller = await Seller.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });

    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream({ folder: 'products' }, (error, result) => {
              if (error) return reject(error);
              resolve(result);
            });
            stream.end(file.buffer);
          });
          imageUrls.push({ url: uploadResult.secure_url });
        } catch (uploadError) {
          console.error('Image upload failed:', uploadError);
          return res.status(500).json({ message: 'Image upload failed', error: uploadError.message });
        }
      }
    }
    // Fallback to default image if no image uploaded
    if (imageUrls.length === 0) {
      imageUrls = [{ url: 'https://res.cloudinary.com/demo/image/upload/v1690000000/products/default-product.png' }];
    }

    let categoryId = req.body.category;
    if (req.body.customCategory) {
      // Create a new category if customCategory is provided
      const slug = req.body.customCategory.toLowerCase().replace(/\s+/g, '-');
      let category = await Category.findOne({ slug });
      if (!category) {
        category = await Category.create({ name: req.body.customCategory, slug });
      }
      categoryId = category._id;
    }

    // Parse and convert fields
    const {
      name, description, shortDescription, price, comparePrice, subCategory, brand, sku, stock, lowStockThreshold, weight, weightUnit, dimensions, variants, tags, shippingInfo, seo
    } = req.body;

    // Convert numeric fields
    const priceNum = price ? Number(price) : undefined;
    const comparePriceNum = comparePrice ? Number(comparePrice) : undefined;
    const stockNum = stock ? Number(stock) : undefined;
    const lowStockThresholdNum = lowStockThreshold ? Number(lowStockThreshold) : undefined;
    const weightNum = weight ? Number(weight) : undefined;
    const weightUnitStr = (weightUnit === 'g' || weightUnit === 'kg') ? weightUnit : 'kg';

    // Parse features and specifications
    let featuresArr = [];
    if (req.body.features) {
      featuresArr = typeof req.body.features === 'string'
        ? req.body.features.split(',').map(f => f.trim()).filter(Boolean)
        : req.body.features;
    }
    let specificationsArr = [];
    if (req.body.specifications) {
      try {
        specificationsArr = typeof req.body.specifications === 'string'
          ? JSON.parse(req.body.specifications)
          : req.body.specifications;
      } catch (e) {
        specificationsArr = [];
      }
    }

    // Parse category and subCategory as ObjectId
    let subCategoryId = req.body.subCategory;
    if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ message: 'Invalid category ID' });
    }
    if (subCategoryId && !mongoose.Types.ObjectId.isValid(subCategoryId)) {
      return res.status(400).json({ message: 'Invalid subCategory ID' });
    }

    // Parse variants if present
    let variantsArr = [];
    if (variants) {
      try {
        variantsArr = typeof variants === 'string' ? JSON.parse(variants) : variants;
      } catch (e) {
        variantsArr = [];
      }
    }

    // Compute weight-based shipping charge and bake into product price
    const grams = (weightNum || 0) * (weightUnitStr === 'g' ? 1 : 1000);
    let shippingCharge = 0;
    if (grams > 0 && grams <= 500) shippingCharge = 45;
    else if (grams > 500 && grams <= 1000) shippingCharge = 75;
    else if (grams > 1000 && grams <= 1500) shippingCharge = 110;
    else if (grams > 1500) shippingCharge = 235; // up to and beyond 2kg capped to last tier

    const finalPrice = (priceNum || 0) + shippingCharge;

    // Normalize incoming shippingInfo object (avoid undefined nested objects)
    let incomingShipping = (typeof shippingInfo === 'object' && shippingInfo !== null) ? shippingInfo : {};
    if (incomingShipping && typeof incomingShipping.dimensions === 'undefined') {
      delete incomingShipping.dimensions;
    }

    const product = new Product({
      name,
      description,
      shortDescription,
      price: finalPrice,
      comparePrice: comparePriceNum,
      images: imageUrls,
      category: categoryId,
      subCategory: subCategoryId,
      brand,
      seller: seller._id,
      sku,
      stock: stockNum,
      lowStockThreshold: lowStockThresholdNum,
      weight: weightNum,
      weightUnit: weightUnitStr,
      dimensions,
      variants: variantsArr,
      specifications: specificationsArr,
      features: featuresArr,
      tags,
      shippingInfo: {
        ...incomingShipping,
        weight: weightNum,
        freeShipping: true,
        shippingCost: shippingCharge
      },
      seo,
      isActive: true,
      isApproved: false // Admin approval required
    });
    await product.save();
    res.status(201).json(product);
  } catch (error) {
    console.error('Product creation error:', error);
    if (error.code === 11000 && error.keyPattern && error.keyPattern.sku) {
      return res.status(400).json({ message: 'SKU must be unique. A product with this SKU already exists.' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message, errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update a product for the current seller
exports.updateProduct = async (req, res) => {
  try {
    const seller = await Seller.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });
    const product = await Product.findOne({ _id: req.params.id, seller: seller._id });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    let imageUrl = product.images && product.images[0] ? product.images[0].url : '';
    if (req.file) {
      try {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: 'products' }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          if (!req.file.buffer) return reject(new Error('No file buffer found in req.file'));
          stream.end(req.file.buffer);
        });
        imageUrl = uploadResult.secure_url;
      } catch (uploadError) {
        return res.status(500).json({ message: 'Image upload failed', error: uploadError.message });
      }
    }

    // Parse fields from req.body
    const {
      name, description, shortDescription, price, comparePrice, category, subCategory, brand, sku, stock, lowStockThreshold, weight, weightUnit, dimensions, variants, tags, shippingInfo, seo, features, specifications
    } = req.body;

    // Parse features and specifications
    let featuresArr = [];
    if (features) {
      featuresArr = typeof features === 'string' ? features.split(',').map(f => f.trim()).filter(Boolean) : features;
    }
    let specificationsArr = [];
    if (specifications) {
      try {
        specificationsArr = typeof specifications === 'string' ? JSON.parse(specifications) : specifications;
      } catch (e) {
        specificationsArr = [];
      }
    }

    // Compute weight-based shipping charge and final price (idempotent)
    const weightNum = (weight !== undefined && weight !== '') ? Number(weight) : (product.weight || 0);
    const weightUnitStr = (weightUnit === 'g' || weightUnit === 'kg') ? weightUnit : (product.weightUnit || 'kg');
    const grams = (weightNum || 0) * (weightUnitStr === 'g' ? 1 : 1000);
    let shippingCharge = 0;
    if (grams > 0 && grams <= 500) shippingCharge = 45;
    else if (grams > 500 && grams <= 1000) shippingCharge = 75;
    else if (grams > 1000 && grams <= 1500) shippingCharge = 110;
    else if (grams > 1500) shippingCharge = 235; // up to and beyond 2kg capped to last tier

    // Derive base price: if incoming price provided, treat it as BASE (without shipping);
    // otherwise, subtract old shipping from stored price to get base.
    const incomingPriceProvided = (price !== undefined && price !== '');
    const basePrice = incomingPriceProvided
      ? Number(price)
      : (Number(product.price || 0) - Number(product.shippingInfo?.shippingCost || 0));
    const finalPrice = (isNaN(basePrice) ? 0 : basePrice) + shippingCharge;

    // Update product fields
    if (name !== undefined && name !== '') product.name = name;
    if (description !== undefined && description !== '') product.description = description;
    if (shortDescription !== undefined) product.shortDescription = shortDescription;
    product.price = finalPrice;
    if (comparePrice !== undefined && comparePrice !== '') product.comparePrice = comparePrice;
    product.images = imageUrl ? [{ url: imageUrl }] : product.images;
    if (category && mongoose.Types.ObjectId.isValid(category)) product.category = category;
    if (subCategory && mongoose.Types.ObjectId.isValid(subCategory)) product.subCategory = subCategory;
    if (brand !== undefined && brand !== '') product.brand = brand;
    if (sku !== undefined && sku !== '') product.sku = sku;
    if (stock !== undefined && stock !== '') product.stock = stock;
    if (lowStockThreshold !== undefined && lowStockThreshold !== '') product.lowStockThreshold = lowStockThreshold;
    if (weight !== undefined && weight !== '') product.weight = weight;
    if (weightUnit === 'kg' || weightUnit === 'g') product.weightUnit = weightUnit;
    if (dimensions && typeof dimensions === 'object') product.dimensions = dimensions;
    if (variants) product.variants = variants;
    if (specificationsArr && specifications !== undefined) product.specifications = specificationsArr;
    if (featuresArr && features !== undefined) product.features = featuresArr;
    if (tags !== undefined) product.tags = tags;
    // Merge previous shippingInfo safely
    // Build a plain object to avoid carrying Mongoose doc internals and undefined fields
    const baseShippingSrc = (typeof shippingInfo === 'object' && shippingInfo !== null)
      ? shippingInfo
      : (product.shippingInfo || {});
    const mergedShippingPlain = JSON.parse(JSON.stringify(baseShippingSrc || {}));
    if (mergedShippingPlain && typeof mergedShippingPlain.dimensions === 'undefined') {
      delete mergedShippingPlain.dimensions;
    }

    product.shippingInfo = {
      ...mergedShippingPlain,
      weight: weightNum,
      freeShipping: true,
      shippingCost: shippingCharge
    };
    product.seo = seo;

    await product.save();
    res.json(product);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message, errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Delete a product for the current seller
exports.deleteProduct = async (req, res) => {
  try {
    const seller = await Seller.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });
    const product = await Product.findOneAndDelete({ _id: req.params.id, seller: seller._id });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Update sold count for a product (seller only)
exports.updateSoldCount = async (req, res) => {
  try {
    const seller = await Seller.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });
    const product = await Product.findOne({ _id: req.params.id, seller: seller._id });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const { soldCount } = req.body;
    if (typeof soldCount !== 'number' || soldCount < 0) {
      return res.status(400).json({ message: 'Invalid soldCount value' });
    }
    product.soldCount = soldCount;
    await product.save();
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Placeholder: Get seller orders
exports.getOrders = (req, res) => {
  res.json({ message: 'Get seller orders' });
};

// Placeholder: Update order status
exports.updateOrderStatus = (req, res) => {
  res.json({ message: 'Update order status' });
};

// Get seller stats (dashboard)
exports.getStats = async (req, res) => {
  try {
    // Find seller by user
    const seller = await Seller.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });

    // Get all products for this seller
    const products = await Product.find({ seller: seller._id });
    const productIds = products.map(p => p._id);

    // Get all orders for this seller
    const Order = require('../models/Order');
    const orders = await Order.find({ seller: seller._id });

    // Total sales (sum of totalPrice for all non-cancelled/refunded orders)
    const totalSales = orders
      .filter(o => o.orderStatus !== 'cancelled' && o.orderStatus !== 'refunded')
      .reduce((sum, o) => sum + (o.totalPrice || 0), 0);

    // Total orders (all orders for this seller)
    const totalOrders = orders.length;

    // Total products
    const totalProducts = products.length;

    // Total unique customers
    const uniqueCustomerIds = new Set(orders.map(o => String(o.user)));
    const totalCustomers = uniqueCustomerIds.size;

    res.json({
      totalSales,
      totalOrders,
      totalProducts,
      totalCustomers
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
}; 

// Sales report (seller) grouped by period
// @route GET /api/sellers/reports/sales?period=daily|monthly|yearly
exports.getSalesReport = async (req, res) => {
  try {
    const period = (req.query.period || 'daily').toLowerCase();
    const SellerModel = Seller;
    const Order = require('../models/Order');

    const seller = await SellerModel.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });

    // Date format expression per period
    let dateFormat = '%Y-%m-%d';
    if (period === 'monthly') dateFormat = '%Y-%m';
    else if (period === 'yearly') dateFormat = '%Y';

    // Define paid revenue criteria: online-paid immediately; COD counted only after delivered
    const paidCriteria = {
      $or: [
        { $and: [ { paymentMethod: { $ne: 'cod' } }, { paymentStatus: 'paid' } ] },
        { $and: [ { paymentMethod: 'cod' }, { orderStatus: 'delivered' } ] }
      ]
    };

    // Primary: aggregation (timezone-aware buckets)
    const pipeline = [
      { $match: { seller: seller._id, ...paidCriteria } },
      { $group: { _id: { $dateToString: { format: dateFormat, date: '$createdAt', timezone: 'Asia/Kolkata' } }, revenue: { $sum: { $ifNull: ['$itemsPrice', 0] } }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ];
    let data = await Order.aggregate(pipeline);

    // Fallback: compute in JS if aggregation unexpectedly returns empty while orders exist
    if (!data || data.length === 0) {
      const orders = await Order.find({ seller: seller._id, ...paidCriteria }).select('createdAt itemsPrice paymentMethod paymentStatus orderStatus');
      if (orders && orders.length > 0) {
        const map = new Map();
        const fmt = (d) => {
          const dt = new Date(d);
          if (period === 'yearly') return String(dt.getFullYear());
          if (period === 'monthly') return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
          return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        };
        for (const o of orders) {
          const key = fmt(o.createdAt);
          const prev = map.get(key) || { revenue: 0, orders: 0 };
          prev.revenue += Number(o.itemsPrice || 0);
          prev.orders += 1;
          map.set(key, prev);
        }
        data = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ _id: k, revenue: v.revenue, orders: v.orders }));
      }
    }

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to build sales report', error: error.message });
  }
};

// Order status summary for seller
// @route GET /api/sellers/orders/status-summary
exports.getOrderStatusSummary = async (req, res) => {
  try {
    const SellerModel = Seller;
    const Order = require('../models/Order');
    const seller = await SellerModel.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });

    // Primary: aggregation
    let agg = await Order.aggregate([
      { $match: { seller: seller._id } },
      { $group: { _id: '$orderStatus', count: { $sum: 1 } } }
    ]);

    // Fallback to JS if aggregation empty but orders exist
    if (!agg || agg.length === 0) {
      const list = await Order.find({ seller: seller._id }).select('orderStatus');
      const map = new Map();
      for (const o of list) {
        const s = o.orderStatus || 'unknown';
        map.set(s, (map.get(s) || 0) + 1);
      }
      agg = Array.from(map.entries()).map(([k, v]) => ({ _id: k, count: v }));
    }

    const counts = agg.reduce((acc, cur) => {
      acc[cur._id || 'unknown'] = cur.count;
      return acc;
    }, {});

    const summary = {
      pending: counts.pending || 0,
      confirmed: counts.confirmed || 0,
      processing: counts.processing || 0,
      shipped: counts.shipped || 0,
      delivered: counts.delivered || 0,
      cancelled: counts.cancelled || 0,
      refunded: counts.refunded || 0
    };

    return res.json({ success: true, summary, raw: counts });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch status summary', error: error.message });
  }
};

// Wallet overview for seller
exports.getWalletOverview = async (req, res) => {
  try {
    const seller = await Seller.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });

    const Order = require('../models/Order');
    const Withdrawal = require('../models/Withdrawal');

    // Earnings rules:
    // - Online: paymentStatus = 'paid'
    // - COD: orderStatus = 'delivered'
    const onlineEarningsAgg = await Order.aggregate([
      { $match: { seller: seller._id, paymentMethod: { $ne: 'cod' }, paymentStatus: 'paid' } },
      { $project: { sellerEarnEff: { $cond: [ { $gt: ['$sellerEarnings', 0] }, '$sellerEarnings', { $subtract: ['$itemsPrice', { $multiply: ['$itemsPrice', 0.07] }] } ] } } },
      { $group: { _id: null, total: { $sum: '$sellerEarnEff' } } }
    ]);
    const codEarningsAgg = await Order.aggregate([
      { $match: { seller: seller._id, paymentMethod: 'cod', orderStatus: 'delivered' } },
      { $project: { sellerEarnEff: { $cond: [ { $gt: ['$sellerEarnings', 0] }, '$sellerEarnings', { $subtract: ['$itemsPrice', { $multiply: ['$itemsPrice', 0.07] }] } ] } } },
      { $group: { _id: null, total: { $sum: '$sellerEarnEff' } } }
    ]);
    const totalEarnings = (onlineEarningsAgg[0]?.total || 0) + (codEarningsAgg[0]?.total || 0);

    const processedWithdrawalsAgg = await Withdrawal.aggregate([
      // NOTE: Withdrawal.seller references User, not Seller
      { $match: { seller: seller.userId, $or: [ { status: 'paid' }, { status: 'processed' } ] } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const withdrawnAmount = processedWithdrawalsAgg[0]?.total || 0;

    const availableBalance = Math.max(0, totalEarnings - withdrawnAmount);

    // Sum of withdrawals not yet paid
    const pendingAgg = await Withdrawal.aggregate([
      { $match: { seller: seller.userId, status: { $in: ['pending', 'processing', 'approved'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const pendingAmount = pendingAgg[0]?.total || 0;

    res.json({ availableBalance, totalEarnings, totalWithdrawn: withdrawnAmount, pendingWithdrawals: pendingAmount });
  } catch (error) {
    res.status(500).json({ message: 'Failed to compute wallet', error: error.message });
  }
};

// Get reviews for current seller's products
exports.getMyReviews = async (req, res) => {
  try {
    const seller = await Seller.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });
    const Product = require('../models/Product');
    const products = await Product.find({ seller: seller._id }).select('name reviews');
    const reviews = [];
    for (const p of products) {
      for (const r of (p.reviews || [])) {
        reviews.push({
          productId: p._id,
          productName: p.name,
          reviewId: r._id,
          userId: r.user,
          userName: r.name,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
          sellerReply: r.sellerReply || null
        });
      }
    }
    res.json(reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (e) {
    res.status(500).json({ message: 'Failed to fetch reviews', error: e.message });
  }
};

// Reply to a specific review for a product owned by current seller
exports.replyToReview = async (req, res) => {
  try {
    const { productId, reviewId } = req.params;
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ message: 'Reply text is required' });

    const seller = await Seller.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });

    const Product = require('../models/Product');
    const product = await Product.findOne({ _id: productId, seller: seller._id });
    if (!product) return res.status(404).json({ message: 'Product not found or not owned by seller' });

    const review = (product.reviews || []).find(r => String(r._id) === String(reviewId));
    if (!review) return res.status(404).json({ message: 'Review not found' });

    review.sellerReply = { text: text.trim(), at: new Date() };
    await product.save();
    res.json({ message: 'Reply saved', sellerReply: review.sellerReply });
  } catch (e) {
    res.status(500).json({ message: 'Failed to reply to review', error: e.message });
  }
};