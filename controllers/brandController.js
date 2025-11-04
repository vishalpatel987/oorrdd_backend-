const Brand = require('../models/Brand');
const { asyncHandler } = require('../middleware/errorMiddleware');
const cloudinary = require('../utils/cloudinary');

// Get all active brands (public)
exports.getAllBrands = asyncHandler(async (req, res) => {
  try {
    const { category } = req.query;
    let query = { isActive: true };
    if (category) {
      query.$or = [{ category: category }, { categories: category }];
    }
    const brands = await Brand.find(query).sort({ sortOrder: 1, name: 1 }).lean();
    res.json({ success: true, data: brands });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching brands', error: error.message });
  }
});

// Get all brands (admin only)
exports.getBrands = asyncHandler(async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can access all brands' });
    }
    const brands = await Brand.find().sort({ sortOrder: 1, name: 1 }).lean();
    res.json({ success: true, data: brands });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching brands', error: error.message });
  }
});

// Get single brand by ID
exports.getBrandById = asyncHandler(async (req, res) => {
  try {
    const brand = await Brand.findById(req.params.id);
    if (!brand) return res.status(404).json({ message: 'Brand not found' });
    res.json({ success: true, data: brand });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching brand', error: error.message });
  }
});

// Create brand (admin only)
exports.createBrand = asyncHandler(async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can create brands' });
    }
    let logoUrl = '';
    if (req.file) {
      try {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: 'brands' }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          stream.end(req.file.buffer);
        });
        logoUrl = uploadResult.secure_url;
      } catch (uploadError) {
        return res.status(500).json({ success: false, message: 'Image upload failed', error: uploadError.message });
      }
    } else if (req.body.logoUrl || req.body.logo) {
      logoUrl = req.body.logoUrl || req.body.logo;
    } else {
      return res.status(400).json({ success: false, message: 'Brand logo is required' });
    }
    const { name, category, categories, website, description, isActive, sortOrder } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Brand name is required' });
    }
    let categoriesArray = [];
    if (categories) {
      try {
        categoriesArray = typeof categories === 'string' ? JSON.parse(categories) : categories;
      } catch (e) {
        categoriesArray = Array.isArray(categories) ? categories : [];
      }
    }
    const brand = new Brand({
      name: name.trim(),
      logo: logoUrl,
      logoUrl: logoUrl,
      category: category || 'Other',
      categories: categoriesArray,
      website: website || '',
      description: description || '',
      isActive: isActive !== undefined ? isActive : true,
      sortOrder: sortOrder ? parseInt(sortOrder) : 0
    });
    await brand.save();
    res.status(201).json({ success: true, message: 'Brand created successfully', data: brand });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Brand with this name already exists' });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ success: false, message: 'Validation error', errors });
    }
    res.status(500).json({ success: false, message: 'Error creating brand', error: error.message });
  }
});

// Update brand (admin only)
exports.updateBrand = asyncHandler(async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can update brands' });
    }
    const brand = await Brand.findById(req.params.id);
    if (!brand) return res.status(404).json({ success: false, message: 'Brand not found' });
    let logoUrl = brand.logo;
    if (req.file) {
      try {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: 'brands' }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          stream.end(req.file.buffer);
        });
        logoUrl = uploadResult.secure_url;
      } catch (uploadError) {
        return res.status(500).json({ success: false, message: 'Image upload failed', error: uploadError.message });
      }
    } else if (req.body.logoUrl || req.body.logo) {
      logoUrl = req.body.logoUrl || req.body.logo;
    }
    const { name, category, categories, website, description, isActive, sortOrder } = req.body;
    let categoriesArray = brand.categories;
    if (categories !== undefined) {
      try {
        categoriesArray = typeof categories === 'string' ? JSON.parse(categories) : categories;
      } catch (e) {
        categoriesArray = Array.isArray(categories) ? categories : brand.categories;
      }
    }
    if (name !== undefined) brand.name = name.trim();
    if (logoUrl) { brand.logo = logoUrl; brand.logoUrl = logoUrl; }
    if (category !== undefined) brand.category = category;
    if (categoriesArray !== undefined) brand.categories = categoriesArray;
    if (website !== undefined) brand.website = website;
    if (description !== undefined) brand.description = description;
    if (isActive !== undefined) brand.isActive = isActive;
    if (sortOrder !== undefined) brand.sortOrder = parseInt(sortOrder);
    await brand.save();
    res.json({ success: true, message: 'Brand updated successfully', data: brand });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Brand with this name already exists' });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ success: false, message: 'Validation error', errors });
    }
    res.status(500).json({ success: false, message: 'Error updating brand', error: error.message });
  }
});

// Delete brand (admin only)
exports.deleteBrand = asyncHandler(async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can delete brands' });
    }
    const brand = await Brand.findById(req.params.id);
    if (!brand) return res.status(404).json({ success: false, message: 'Brand not found' });
    await Brand.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Brand deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting brand', error: error.message });
  }
});
