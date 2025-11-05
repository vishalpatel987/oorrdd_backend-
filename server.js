const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');
const { Server } = require('socket.io');
const User = require('./models/User');
const Message = require('./models/Message');
const Conversation = require('./models/Conversation');

// Load environment variables - explicitly from backend/.env
dotenv.config({ path: path.join(__dirname, '.env') });

// Debug: Log ADMIN_EMAIL and Email config (EMAIL_* format is primary, SMTP_* is fallback)
console.log('');
console.log('========================================');
console.log('🔍 ENVIRONMENT VARIABLES DEBUG');
console.log('========================================');
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('ADMIN_EMAIL:', process.env.ADMIN_EMAIL || '❌ NOT SET');
console.log('');
console.log('📧 EMAIL CONFIGURATION (SMTP_* format is primary):');
console.log('SMTP_HOST:', process.env.SMTP_HOST || '❌ NOT SET (will use EMAIL_HOST as fallback)');
console.log('SMTP_PORT:', process.env.SMTP_PORT || '❌ NOT SET (will use EMAIL_PORT as fallback, default: 587)');
console.log('SMTP_EMAIL:', process.env.SMTP_EMAIL ? (process.env.NODE_ENV === 'production' ? '✅ SET' : process.env.SMTP_EMAIL) : '❌ NOT SET (will use EMAIL_USER as fallback)');
console.log('SMTP_PASSWORD:', process.env.SMTP_PASSWORD ? '✅ SET' : '❌ NOT SET (will use EMAIL_PASS as fallback)');
console.log('EMAIL_FROM:', process.env.EMAIL_FROM || '❌ NOT SET');
console.log('');
console.log('📧 FALLBACK CONFIGURATION (EMAIL_* format):');
console.log('EMAIL_HOST:', process.env.EMAIL_HOST || '❌ NOT SET');
console.log('EMAIL_PORT:', process.env.EMAIL_PORT || '❌ NOT SET');
console.log('EMAIL_USER:', process.env.EMAIL_USER ? (process.env.NODE_ENV === 'production' ? '✅ SET' : process.env.EMAIL_USER) : '❌ NOT SET');
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? '✅ SET' : '❌ NOT SET');
console.log('');
console.log('📧 RESOLVED CONFIGURATION (what will be used):');
const resolvedHost = process.env.SMTP_HOST || process.env.EMAIL_HOST;
const resolvedPort = process.env.SMTP_PORT || process.env.EMAIL_PORT || '587';
const resolvedUser = process.env.SMTP_EMAIL || process.env.EMAIL_USER;
const resolvedPass = process.env.SMTP_PASSWORD || process.env.EMAIL_PASS;
console.log('HOST:', resolvedHost || '❌ MISSING');
console.log('PORT:', resolvedPort);
console.log('USER:', resolvedUser ? (process.env.NODE_ENV === 'production' ? '✅ SET' : resolvedUser) : '❌ MISSING');
console.log('PASSWORD:', resolvedPass ? '✅ SET' : '❌ MISSING');
console.log('FROM:', process.env.EMAIL_FROM || resolvedUser || '❌ MISSING');
console.log('========================================');
console.log('');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const sellerRoutes = require('./routes/sellerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const chatRoutes = require('./routes/chatRoutes');
const couponRoutes = require('./routes/couponRoutes');
const translateRoutes = require('./routes/translateRoutes');
const withdrawalRoutes = require('./routes/withdrawalRoutes');
const shippingRoutes = require('./routes/shippingRoutes');
const returnRoutes = require('./routes/returnRoutes');
const contactRoutes = require('./routes/contactRoutes');
const bannerRoutes = require('./routes/bannerRoutes');
const brandRoutes = require('./routes/brandRoutes');

// Import middleware
const { errorHandler } = require('./middleware/errorMiddleware');

// Import database connection
const connectDB = require('./config/db');

// Initialize express app
const app = express();

// CORS configuration - must be at the top and explicit for local dev
const allowedOrigins = [
  'http://localhost:3000',
  'https://oorrdd-frontend.vercel.app',
  'https://mv-store-ram312908-gmailcoms-projects.vercel.app'
];

// Add FRONTEND_URL_PRODUCTION if it exists
if (process.env.FRONTEND_URL_PRODUCTION) {
  const frontendUrl = process.env.FRONTEND_URL_PRODUCTION.trim();
  if (frontendUrl && !allowedOrigins.includes(frontendUrl)) {
    allowedOrigins.push(frontendUrl);
  }
}

// Log allowed origins for debugging
console.log('Allowed CORS origins:', allowedOrigins);

// CORS configuration with proper preflight handling
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, or server-to-server requests)
    if (!origin) {
      console.log('Request with no origin - allowing');
      return callback(null, true);
    }
    
    console.log('Request origin:', origin);
    console.log('Allowed origins:', allowedOrigins);
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log('✅ Origin allowed:', origin);
      return callback(null, true);
    }
    
    // In production, allow all origins for debugging (remove this in production if you want strict CORS)
    if (process.env.NODE_ENV === 'production') {
      console.log('⚠️ Production mode - allowing origin:', origin);
      return callback(null, true);
    }
    
    // Development: strict checking
    console.log('❌ Origin blocked:', origin);
    callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',
    'X-Requested-With'
  ],
  exposedHeaders: ['Content-Length', 'Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400 // Cache preflight requests for 24 hours
}));

// Handle preflight OPTIONS requests explicitly for all routes
app.options('*', cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'production') {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  optionsSuccessStatus: 204
}));

// Connect to MongoDB
connectDB();

// Security middleware - configure Helmet to work with CORS
// IMPORTANT: Helmet should be configured to not interfere with CORS
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false, // Allow cross-origin iframes/embeds if needed
  contentSecurityPolicy: false // Disable CSP that might interfere with CORS
}));
app.use(compression());

// Rate limiting - skip OPTIONS requests (preflight)
const rateLimitSkipPreflight = (limiter) => {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') {
      return next(); // Skip rate limiting for preflight requests
    }
    return limiter(req, res, next);
  };
};

if (process.env.NODE_ENV === 'production') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // strict in production
    message: 'Too many requests from this IP, please try again later.'
  });
  app.use('/api/', rateLimitSkipPreflight(limiter));
} else {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10000, // very high for dev
    message: 'Too many requests from this IP, please try again later.'
  });
  app.use('/api/', rateLimitSkipPreflight(limiter));
}

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads/chat', express.static(path.join(__dirname, 'uploads/chat')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/sellers', sellerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/translate', translateRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/contact', contactRoutes);

// RapidShyp webhook (must be before error handler and should accept raw body)
const shippingController = require('./controllers/shippingController');
app.post('/api/webhooks/rapidshyp', express.json({ type: '*/*' }), shippingController.webhook);

// Test route to verify server is working
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is working!', 
    timestamp: new Date().toISOString(),
    cors: 'CORS should be working'
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    message: 'Server is running', 
    timestamp: new Date().toISOString() 
  });
});

// PDF Proxy endpoint - serves PDFs from Cloudinary with inline headers for direct viewing
app.get('/api/document/view', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ message: 'URL parameter is required' });
    }
    
    // Decode URL if it's encoded
    const decodedUrl = decodeURIComponent(url);
    
    // Validate URL is from Cloudinary (security check)
    if (!decodedUrl.includes('cloudinary.com') && !decodedUrl.includes('res.cloudinary.com')) {
      return res.status(400).json({ message: 'Invalid document URL' });
    }
    
    console.log('📄 Fetching PDF from:', decodedUrl);
    
    // Fetch PDF from Cloudinary
    const axios = require('axios');
    const response = await axios.get(decodedUrl, {
      responseType: 'stream',
      headers: {
        'Accept': 'application/pdf, */*',
        'User-Agent': 'Mozilla/5.0'
      },
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
      maxRedirects: 5,
      timeout: 30000
    });
    
    // Check if response is valid
    if (response.status >= 400) {
      return res.status(response.status).json({ message: 'Failed to fetch document from Cloudinary' });
    }
    
    // Get content type from response - force PDF if it's a PDF file
    let contentType = response.headers['content-type'] || 'application/pdf';
    
    // Check if URL is for a PDF (even if Cloudinary serves it with wrong content-type)
    const urlLower = decodedUrl.toLowerCase();
    const isPdfUrl = urlLower.includes('/raw/') || 
                     urlLower.includes('resource_type=raw') ||
                     urlLower.endsWith('.pdf') ||
                     urlLower.includes('format=pdf');
    
    // Check if it's a vendor document (likely PDFs)
    // Vendor documents are usually PDFs even if stored in /image/upload
    const isVendorDocument = decodedUrl.includes('vendor-documents');
    
    // Check by query parameter if document type is specified
    const docType = (req.query.type || '').toLowerCase();
    const docName = (req.query.name || '').toLowerCase();
    
    // Check if document name indicates it's a PDF
    const isPdfByName = docName.includes('pdf') || 
                       docName.includes('aadhar') || 
                       docName.includes('pan') ||
                       docName.includes('gst') ||
                       docName.includes('certificate') ||
                       docName.includes('statement') ||
                       docName.includes('license') ||
                       docName.includes('proof') ||
                       docName.includes('card');
    
    // Force PDF content type if it's a PDF file or vendor document
    // Vendor documents are often PDFs even if Cloudinary serves them as images/jpeg
    if (isPdfUrl || isVendorDocument || isPdfByName || docType.includes('pdf') || docType.includes('aadhar') || docType.includes('pan') || docType.includes('gst') || docType.includes('certificate') || docType.includes('statement') || docType.includes('license') || docType.includes('proof')) {
      contentType = 'application/pdf';
      console.log('📄 Forcing PDF content-type. Original:', response.headers['content-type'], 'Forced: application/pdf');
      console.log('📄 URL:', decodedUrl);
      console.log('📄 Document name:', docName || 'N/A');
    } else {
      console.log('📄 Content-Type from Cloudinary:', contentType);
    }
    
    // Set headers for inline viewing (not download) - CRITICAL for browser inline viewing
    res.setHeader('Content-Type', contentType);
    
    // For PDFs, use inline; for images, also use inline
    if (contentType.includes('pdf') || isPdfUrl) {
      res.setHeader('Content-Disposition', 'inline; filename="document.pdf"'); // 'inline' forces browser to display, not download
    } else {
      res.setHeader('Content-Disposition', 'inline; filename="document"');
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow iframe/object embedding
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle errors in stream
    response.data.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error streaming PDF', error: error.message });
      }
    });
    
    // Pipe the PDF stream to response
    response.data.pipe(res);
    
  } catch (error) {
    console.error('PDF proxy error:', error.message);
    console.error('Error stack:', error.stack);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to fetch document', error: error.message });
    }
  }
});

// Email test endpoint (for debugging Email configuration - SMTP_* format is primary)
app.get('/api/test-email', async (req, res) => {
  const sendEmail = require('./utils/sendEmail');
  
  // Check if test email address is provided
  const testEmail = req.query.email || process.env.TEST_EMAIL || process.env.ADMIN_EMAIL;
  
  // Check Email configuration - SMTP_* format is primary, EMAIL_* is fallback
  const host = (process.env.SMTP_HOST || process.env.EMAIL_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587') || 587;
  const user = (process.env.SMTP_EMAIL || process.env.EMAIL_USER || '').trim();
  const pass = (process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || '').trim();
  
  const configStatus = {
    smtpHost: process.env.SMTP_HOST ? '✅ SET' : '❌ NOT SET',
    emailHost: process.env.EMAIL_HOST ? '✅ SET (fallback)' : '❌ NOT SET',
    resolvedHost: host ? '✅ SET' : '❌ MISSING',
    smtpPort: process.env.SMTP_PORT ? `✅ ${process.env.SMTP_PORT}` : '❌ NOT SET',
    emailPort: process.env.EMAIL_PORT ? `✅ ${process.env.EMAIL_PORT} (fallback)` : '❌ NOT SET',
    resolvedPort: port ? `✅ ${port}` : '❌ MISSING',
    smtpEmail: process.env.SMTP_EMAIL ? '✅ SET' : '❌ NOT SET',
    emailUser: process.env.EMAIL_USER ? '✅ SET (fallback)' : '❌ NOT SET',
    resolvedUser: user ? '✅ SET' : '❌ MISSING',
    smtpPassword: process.env.SMTP_PASSWORD ? '✅ SET' : '❌ NOT SET',
    emailPass: process.env.EMAIL_PASS ? '✅ SET (fallback)' : '❌ NOT SET',
    resolvedPass: pass ? '✅ SET' : '❌ MISSING',
    emailFrom: process.env.EMAIL_FROM || '❌ NOT SET',
    testEmail: testEmail || '❌ NOT PROVIDED (use ?email=your@email.com)'
  };
  
  // If email is provided, try to send test email
  if (testEmail && host && user && pass) {
    try {
      await sendEmail({
        email: testEmail,
        subject: 'Test Email from MV Store Backend',
        message: 'This is a test email to verify SMTP configuration is working correctly.',
        html: '<p>This is a <strong>test email</strong> to verify SMTP configuration is working correctly.</p><p>If you received this, your email setup is working! ✅</p>'
      });
      
      return res.json({
        success: true,
        message: 'Test email sent successfully!',
        config: configStatus,
        recipient: testEmail,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send test email',
        error: error.message,
        config: configStatus,
        recipient: testEmail,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // Just return config status if no email provided or missing config
  return res.json({
    success: false,
    message: testEmail ? 'Email configuration incomplete. Please set SMTP_HOST, SMTP_EMAIL, and SMTP_PASSWORD (or EMAIL_* as fallback)' : 'Provide email address: /api/test-email?email=your@email.com',
    note: 'SMTP_* format is preferred (SMTP_HOST, SMTP_EMAIL, SMTP_PASSWORD). EMAIL_* format works as fallback.',
    config: configStatus,
    timestamp: new Date().toISOString()
  });
});

// Timeout middleware: respond with 503 if request takes too long
// BUT skip timeout for contact form (it handles its own response)
app.use((req, res, next) => {
  // Skip timeout for contact form - it sends response immediately
  if (req.path === '/api/contact' && req.method === 'POST') {
    return next();
  }
  
  res.setTimeout(15000, () => {
    if (!res.headersSent) {
      res.status(503).json({ message: 'Server timeout, please try again.' });
    }
  });
  next();
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// --- SOCKET.IO SETUP ---
const socketOrigins = [
  'http://localhost:3000',
  'https://oorrdd-frontend.vercel.app',
  'https://mv-store-ram312908-gmailcoms-projects.vercel.app'
];

// Add FRONTEND_URL_PRODUCTION if it exists
if (process.env.FRONTEND_URL_PRODUCTION) {
  socketOrigins.push(process.env.FRONTEND_URL_PRODUCTION);
}

const io = new Server(server, {
  cors: {
    origin: socketOrigins,
    credentials: true
  }
});

const onlineUsers = new Map();

io.on('connection', (socket) => {
  // User joins with their userId
  socket.on('join', (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
  });

  // Join conversation room
  socket.on('joinConversation', (conversationId) => {
    socket.join(conversationId);
  });

  // Handle sending message
  socket.on('sendMessage', async ({ conversationId, senderId, text, fileUrl, fileType }) => {
    try {
      // Fetch sender name from DB
      const sender = await User.findById(senderId).select('name');
      io.to(conversationId).emit('receiveMessage', {
        conversationId,
        senderId,
        senderName: sender ? sender.name : '',
        text,
        fileUrl,
        fileType,
        createdAt: new Date().toISOString()
      });
      // --- Emit unreadCountsUpdate to all participants ---
      const conversation = await Conversation.findById(conversationId);
      if (conversation) {
        for (const participantId of conversation.participants) {
          const unreadCounts = await getUnreadCountsForUser(participantId);
          const socketId = onlineUsers.get(participantId.toString());
          if (socketId) {
            io.to(socketId).emit('unreadCountsUpdate', unreadCounts);
          }
        }
      }
    } catch (err) {
      console.error('Socket sendMessage error:', err);
    }
  });

  // Handle markAsRead event
  socket.on('markAsRead', async ({ conversationId, userId }) => {
    try {
      await Message.updateMany(
        { conversation: conversationId, readBy: { $ne: userId } },
        { $addToSet: { readBy: userId } }
      );
      // --- Emit unreadCountsUpdate to all participants ---
      const conversation = await Conversation.findById(conversationId);
      if (conversation) {
        for (const participantId of conversation.participants) {
          const unreadCounts = await getUnreadCountsForUser(participantId);
          const socketId = onlineUsers.get(participantId.toString());
          if (socketId) {
            io.to(socketId).emit('unreadCountsUpdate', unreadCounts);
          }
        }
      }
    } catch (err) {
      console.error('Socket markAsRead error:', err);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
    }
  });

  // Typing indicator
  socket.on('typing', ({ conversationId, userId, userName }) => {
    socket.to(conversationId).emit('typing', { conversationId, userId, userName });
  });
  socket.on('stopTyping', ({ conversationId, userId }) => {
    socket.to(conversationId).emit('stopTyping', { conversationId, userId });
  });
});

// Helper: Get unread counts for all conversations for a user
async function getUnreadCountsForUser(userId) {
  const conversations = await Conversation.find({ participants: userId });
  const unreadCounts = {};
  for (const conv of conversations) {
    const count = await Message.countDocuments({
      conversation: conv._id,
      readBy: { $ne: userId },
      sender: { $ne: userId }
    });
    unreadCounts[conv._id] = count;
  }
  return unreadCounts;
}

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Optionally: alert admin, log to file, etc.
  // Do NOT shut down the server automatically!
});

module.exports = app; 