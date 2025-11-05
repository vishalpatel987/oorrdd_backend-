const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Determine which MongoDB URI to use
    // Priority: 
    // 1. If NODE_ENV is production and MONGODB_URI_PROD is valid, use it
    // 2. Otherwise, use MONGODB_URI (for development or if PROD is not set/invalid)
    let mongoUri = process.env.MONGODB_URI;
    let envVar = 'MONGODB_URI';
    
    if (process.env.NODE_ENV === 'production' && process.env.MONGODB_URI_PROD) {
      const prodUri = process.env.MONGODB_URI_PROD.trim();
      // Only use PROD URI if it's a valid MongoDB connection string (not a placeholder)
      if (prodUri.startsWith('mongodb://') || prodUri.startsWith('mongodb+srv://')) {
        if (!prodUri.includes('your_mongodb') && !prodUri.includes('placeholder') && !prodUri.includes('example')) {
          mongoUri = prodUri;
          envVar = 'MONGODB_URI_PROD';
        }
      }
    }
    
    // Check if MongoDB URI is set
    if (!mongoUri) {
      console.error(`❌ Error: MongoDB connection string is not set`);
      console.error(`   Please set MONGODB_URI in your .env file`);
      console.error(`   For local development: MONGODB_URI=mongodb://localhost:27017/mv-ecommerce`);
      console.error(`   For production: MONGODB_URI_PROD=mongodb+srv://username:password@cluster.mongodb.net/database`);
      process.exit(1);
    }
    
    // Check if URI starts with valid scheme
    const trimmedUri = mongoUri.trim();
    if (!trimmedUri.startsWith('mongodb://') && !trimmedUri.startsWith('mongodb+srv://')) {
      console.error(`❌ Error: Invalid MongoDB connection string format`);
      console.error(`   Connection string must start with "mongodb://" or "mongodb+srv://"`);
      console.error(`   Current value starts with: ${trimmedUri.substring(0, 20)}...`);
      console.error(`   Please check your ${envVar} in .env file`);
      console.error(`   For local development: MONGODB_URI=mongodb://localhost:27017/mv-ecommerce`);
      console.error(`   For production: MONGODB_URI_PROD=mongodb+srv://username:password@cluster.mongodb.net/database`);
      process.exit(1);
    }
    
    // Check if it's a placeholder value
    if (trimmedUri.includes('your_mongodb') || trimmedUri.includes('placeholder') || trimmedUri.includes('example')) {
      console.error(`❌ Error: MongoDB connection string appears to be a placeholder`);
      console.error(`   Please replace it with your actual MongoDB connection string`);
      console.error(`   For local development: MONGODB_URI=mongodb://localhost:27017/mv-ecommerce`);
      console.error(`   For production: MONGODB_URI_PROD=mongodb+srv://username:password@cluster.mongodb.net/database`);
      process.exit(1);
    }
    
    console.log(`📡 Connecting to MongoDB...`);
    const conn = await mongoose.connect(
      trimmedUri,
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }
    );

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    if (error.message.includes('Invalid scheme')) {
      console.error(`   Please check your MongoDB connection string in .env file`);
      console.error(`   It should start with "mongodb://" or "mongodb+srv://"`);
    }
    process.exit(1);
  }
};

module.exports = connectDB; 