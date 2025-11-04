const Category = require('../models/Category');
const { asyncHandler } = require('../middleware/errorMiddleware');
const cloudinary = require('../utils/cloudinary');

exports.getCategories = asyncHandler(async (req, res) => {
  try {
    // Fetch all categories with parent category populated
    const categories = await Category.find()
      .populate('parentCategory', 'name slug')
      .lean()
      .sort({ level: 1, name: 1 }); // Sort by level first (main categories first), then by name
    res.json(categories);
  } catch (error) {
    error.type = 'GetCategoriesError';
    throw error;
  }
});

exports.getCategory = asyncHandler(async (req, res) => {
  try {
    const category = await Category.findById(req.params.id).lean();
    if (!category) return res.status(404).json({ message: 'Category not found' });
    // Find subcategories
    const subcategories = await Category.find({ parentCategory: category._id }).lean();
    category.subcategories = subcategories;
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

exports.createCategory = async (req, res) => {
  try {
    // Validate required fields
    const { name, slug, description, parentCategory } = req.body;
    
    if (!name || !slug) {
      return res.status(400).json({ 
        message: 'Name and slug are required',
        received: { name: !!name, slug: !!slug }
      });
    }

    // Check if category with same slug already exists
    const existingCategory = await Category.findOne({ slug: slug.toLowerCase().trim() });
    if (existingCategory) {
      return res.status(400).json({ 
        message: 'Category with this slug already exists',
        slug: slug
      });
    }

    // Handle image upload
    let imageUrl = '';
    if (req.file) {
      try {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: 'categories' }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          stream.end(req.file.buffer);
        });
        imageUrl = uploadResult.secure_url;
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return res.status(500).json({ message: 'Image upload failed', error: uploadError.message });
      }
    }
    
    // Use default image if no image provided
    if (!imageUrl) {
      imageUrl = 'https://res.cloudinary.com/demo/image/upload/v1690000000/categories/default-category.png';
    }

    // Validate parentCategory if provided
    let parentCategoryId = null;
    if (parentCategory && parentCategory !== '' && parentCategory !== 'null') {
      const parentExists = await Category.findById(parentCategory);
      if (!parentExists) {
        return res.status(400).json({ message: 'Parent category not found' });
      }
      parentCategoryId = parentCategory;
    }

    // Create category
    const category = new Category({
      name: name.trim(),
      slug: slug.toLowerCase().trim(),
      description: description ? description.trim() : '',
      image: imageUrl,
      parentCategory: parentCategoryId,
      isActive: req.body.isActive !== undefined ? req.body.isActive : true,
      isFeatured: req.body.isFeatured !== undefined ? req.body.isFeatured : false,
      sortOrder: req.body.sortOrder ? parseInt(req.body.sortOrder) : 0,
      metaTitle: req.body.metaTitle ? req.body.metaTitle.trim() : '',
      metaDescription: req.body.metaDescription ? req.body.metaDescription.trim() : ''
    });

    await category.save();
    res.status(201).json({ 
      message: 'Category created successfully',
      category 
    });
  } catch (error) {
    console.error('Create category error:', error);
    
    // Handle duplicate slug error
    if (error.code === 11000) {
      return res.status(400).json({ 
        message: 'Category with this slug already exists',
        field: 'slug'
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        message: 'Validation error',
        errors 
      });
    }
    
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    let imageUrl = category.image;
    if (req.file) {
      try {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: 'categories' }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          stream.end(req.file.buffer);
        });
        imageUrl = uploadResult.secure_url;
      } catch (uploadError) {
        return res.status(500).json({ message: 'Image upload failed', error: uploadError.message });
      }
    }
    const { name, slug, description, parentCategory, level, isActive, isFeatured, sortOrder, metaTitle, metaDescription } = req.body;
    category.name = name || category.name;
    category.slug = slug || category.slug;
    category.description = description || category.description;
    category.image = imageUrl;
    category.parentCategory = parentCategory || category.parentCategory;
    category.level = level || category.level;
    category.isActive = isActive !== undefined ? isActive : category.isActive;
    category.isFeatured = isFeatured !== undefined ? isFeatured : category.isFeatured;
    category.sortOrder = sortOrder || category.sortOrder;
    category.metaTitle = metaTitle || category.metaTitle;
    category.metaDescription = metaDescription || category.metaDescription;
    await category.save();
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.deleteCategory = asyncHandler(async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    const subcategories = await Category.find({ parentCategory: category._id });
    if (subcategories.length > 0) {
      return res.status(400).json({ message: 'Cannot delete category with subcategories. Please delete subcategories first.' });
    }
    await category.deleteOne();
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
}); 