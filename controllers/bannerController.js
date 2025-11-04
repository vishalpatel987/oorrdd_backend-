const HeroBanner = require('../models/HeroBanner');
const { asyncHandler } = require('../middleware/errorMiddleware');
const cloudinary = require('../utils/cloudinary');

// Get all active hero banners (public)
exports.getAllBanners = asyncHandler(async (req, res) => {
  try {
    const banners = await HeroBanner.find({ isActive: true })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();
    
    // Format response to match frontend expectations
    const formattedBanners = banners.map(banner => ({
      _id: banner._id,
      title: banner.title || '',
      imageUrl: banner.imageUrl || banner.image || '',
      image: banner.image || banner.imageUrl || '',
      buttonText: banner.buttonText || 'Shop Now',
      buttonLink: banner.buttonLink || '/products',
      description: banner.description || '',
      sortOrder: banner.sortOrder || 0,
      isActive: banner.isActive
    }));

    res.json({
      success: true,
      data: formattedBanners
    });
  } catch (error) {
    console.error('Error fetching banners:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching banners',
      error: error.message
    });
  }
});

// Get all banners (admin only)
exports.getBanners = asyncHandler(async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can access all banners' });
    }
    
    const banners = await HeroBanner.find()
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();
    
    res.json({
      success: true,
      data: banners
    });
  } catch (error) {
    console.error('Error fetching banners:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching banners',
      error: error.message
    });
  }
});

// Get single banner by ID
exports.getBannerById = asyncHandler(async (req, res) => {
  try {
    const banner = await HeroBanner.findById(req.params.id);
    if (!banner) {
      return res.status(404).json({ message: 'Banner not found' });
    }
    res.json({
      success: true,
      data: banner
    });
  } catch (error) {
    console.error('Error fetching banner:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching banner',
      error: error.message
    });
  }
});

// Create banner (admin only)
exports.createBanner = asyncHandler(async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can create banners' });
    }

    let imageUrl = '';
    
    // Handle image upload
    if (req.file) {
      try {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: 'hero-banners' }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          stream.end(req.file.buffer);
        });
        imageUrl = uploadResult.secure_url;
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return res.status(500).json({ 
          success: false,
          message: 'Image upload failed', 
          error: uploadError.message 
        });
      }
    } else if (req.body.imageUrl) {
      // If imageUrl is provided directly
      imageUrl = req.body.imageUrl;
    } else {
      return res.status(400).json({ 
        success: false,
        message: 'Image is required' 
      });
    }

    const { title, buttonText, buttonLink, description, sortOrder, isActive } = req.body;

    const banner = new HeroBanner({
      title: title || '',
      imageUrl: imageUrl,
      image: imageUrl, // Also set image field for compatibility
      buttonText: buttonText || 'Shop Now',
      buttonLink: buttonLink || '/products',
      description: description || '',
      sortOrder: sortOrder ? parseInt(sortOrder) : 0,
      isActive: isActive !== undefined ? isActive : true
    });

    await banner.save();
    
    res.status(201).json({
      success: true,
      message: 'Banner created successfully',
      data: banner
    });
  } catch (error) {
    console.error('Error creating banner:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating banner',
      error: error.message
    });
  }
});

// Update banner (admin only)
exports.updateBanner = asyncHandler(async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can update banners' });
    }

    const banner = await HeroBanner.findById(req.params.id);
    if (!banner) {
      return res.status(404).json({ 
        success: false,
        message: 'Banner not found' 
      });
    }

    let imageUrl = banner.imageUrl || banner.image;

    // Handle image upload if new image provided
    if (req.file) {
      try {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({ folder: 'hero-banners' }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
          });
          stream.end(req.file.buffer);
        });
        imageUrl = uploadResult.secure_url;
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return res.status(500).json({ 
          success: false,
          message: 'Image upload failed', 
          error: uploadError.message 
        });
      }
    } else if (req.body.imageUrl) {
      imageUrl = req.body.imageUrl;
    }

    const { title, buttonText, buttonLink, description, sortOrder, isActive } = req.body;

    // Update fields
    if (title !== undefined) banner.title = title;
    if (imageUrl) {
      banner.imageUrl = imageUrl;
      banner.image = imageUrl;
    }
    if (buttonText !== undefined) banner.buttonText = buttonText;
    if (buttonLink !== undefined) banner.buttonLink = buttonLink;
    if (description !== undefined) banner.description = description;
    if (sortOrder !== undefined) banner.sortOrder = parseInt(sortOrder);
    if (isActive !== undefined) banner.isActive = isActive;

    await banner.save();
    
    res.json({
      success: true,
      message: 'Banner updated successfully',
      data: banner
    });
  } catch (error) {
    console.error('Error updating banner:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating banner',
      error: error.message
    });
  }
});

// Delete banner (admin only)
exports.deleteBanner = asyncHandler(async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can delete banners' });
    }

    const banner = await HeroBanner.findById(req.params.id);
    if (!banner) {
      return res.status(404).json({ 
        success: false,
        message: 'Banner not found' 
      });
    }

    await banner.deleteOne();
    
    res.json({
      success: true,
      message: 'Banner deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting banner:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting banner',
      error: error.message
    });
  }
});

