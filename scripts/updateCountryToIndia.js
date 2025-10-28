const mongoose = require('mongoose');
const Seller = require('../models/Seller');
const User = require('../models/User');
const Order = require('../models/Order');
require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGODB_URI_PROD);
    console.log('MongoDB Connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Update country to India for existing records
const updateCountryToIndia = async () => {
  try {
    console.log('Starting country update to India...');
    
    // Update Seller model
    const sellerResult = await Seller.updateMany(
      { 'address.country': 'US' },
      { $set: { 'address.country': 'India' } }
    );
    console.log(`Updated ${sellerResult.modifiedCount} sellers' country to India`);
    
    // Update User model
    const userResult = await User.updateMany(
      { 'addresses.country': 'United States' },
      { $set: { 'addresses.$[].country': 'India' } }
    );
    console.log(`Updated ${userResult.modifiedCount} users' country to India`);
    
    // Update Order model
    const orderResult = await Order.updateMany(
      { 'shippingAddress.country': 'United States' },
      { $set: { 'shippingAddress.country': 'India' } }
    );
    console.log(`Updated ${orderResult.modifiedCount} orders' country to India`);
    
    console.log('Country update completed successfully!');
    
  } catch (error) {
    console.error('Error updating country:', error);
  } finally {
    mongoose.connection.close();
  }
};

// Run the update
connectDB().then(() => {
  updateCountryToIndia();
});
