const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const Seller = require('../models/Seller');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/chat');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Safe caster to ObjectId
function toObjectId(id) {
  if (!id) return null;
  const str = String(id);
  if (mongoose.isValidObjectId(str)) return new mongoose.Types.ObjectId(str);
  return null;
}

// Upload file for chat
router.post('/upload', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const fileUrl = `/uploads/chat/${req.file.filename}`;
    const fileType = req.file.mimetype;
    
    res.json({ 
      fileUrl, 
      fileType,
      filename: req.file.filename 
    });
  } catch (err) {
    res.status(500).json({ message: 'File upload failed', error: err.message });
  }
});

// Get all users except self, filtered by role for chat
router.get('/users', protect, async (req, res) => {
  try {
    let filter = { _id: { $ne: req.user._id } };
    if (req.user.role === 'customer') {
      filter.role = 'seller';
    } else if (req.user.role === 'seller') {
      filter.role = 'customer';
    } else {
      // Admins see no one
      return res.json([]);
    }
    const users = await User.find(filter).select('_id name email role');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
});

// Get all conversations for logged-in user
router.get('/conversations', protect, async (req, res) => {
  try {
    const selfId = toObjectId(req.user._id);
    if (!selfId) return res.status(400).json({ message: 'Invalid user id' });
    const conversations = await Conversation.find({ participants: { $in: [selfId] } }).populate('participants', 'name email role');
    // For each conversation, count unread messages for this user and get last message
    const unreadCounts = {};
    const lastMessages = {};
    for (const conv of conversations) {
      const count = await Message.countDocuments({
        conversation: conv._id,
        readBy: { $ne: selfId },
        sender: { $ne: selfId }
      });
      unreadCounts[conv._id] = count;
      // Get last message
      const lastMsg = await Message.findOne({ conversation: conv._id }).sort({ createdAt: -1 }).populate('sender', 'name');
      lastMessages[conv._id] = lastMsg ? {
        text: lastMsg.text,
        createdAt: lastMsg.createdAt,
        sender: lastMsg.sender ? { _id: lastMsg.sender._id, name: lastMsg.sender.name } : null,
        delivered: lastMsg.delivered,
        readBy: lastMsg.readBy
      } : null;
    }
    res.json({ conversations, unreadCounts, lastMessages });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch conversations', error: err.message });
  }
});

// Get messages for a conversation and mark as read
router.get('/messages/:conversationId', protect, async (req, res) => {
  try {
    const selfId = toObjectId(req.user._id);
    if (!selfId) return res.status(400).json({ message: 'Invalid user id' });
    const messages = await Message.find({ conversation: req.params.conversationId }).populate('sender', 'name email');
    // Mark all messages as read by this user
    await Message.updateMany(
      { conversation: req.params.conversationId, readBy: { $ne: selfId } },
      { $addToSet: { readBy: selfId } }
    );
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch messages', error: err.message });
  }
});

// Start a new conversation (or get existing)
router.post('/conversations', protect, async (req, res) => {
  try {
    const { userId, sellerId } = req.body;
    if (!userId && !sellerId) return res.status(400).json({ message: 'userId or sellerId is required' });
    const selfId = toObjectId(req.user._id);
    let otherResolvedId = null;
    if (userId) {
      otherResolvedId = toObjectId(userId);
    } else if (sellerId) {
      // Allow starting a chat using Seller collection id by resolving to the seller's userId
      const seller = mongoose.isValidObjectId(String(sellerId)) ? await Seller.findById(sellerId).select('userId') : null;
      otherResolvedId = seller ? toObjectId(seller.userId) : null;
    }
    const otherId = otherResolvedId;
    if (!selfId || !otherId) return res.status(400).json({ message: 'Invalid ids' });
    let conversation = await Conversation.findOne({ participants: { $all: [selfId, otherId] } });
    if (!conversation) {
      conversation = await Conversation.create({ participants: [selfId, otherId] });
    }
    // Populate participants so the frontend always has seller/customer names immediately
    const populated = await Conversation.findById(conversation._id).populate('participants', 'name email role');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: 'Failed to start conversation', error: err.message });
  }
});

// Send a message
router.post('/messages', protect, async (req, res) => {
  try {
    const { conversationId, text, fileUrl, fileType } = req.body;
    if (!conversationId) return res.status(400).json({ message: 'conversationId is required' });
    const selfId = toObjectId(req.user._id);
    if (!selfId) return res.status(400).json({ message: 'Invalid user id' });
    const message = await Message.create({
      conversation: conversationId,
      sender: selfId,
      text,
      fileUrl,
      fileType,
      delivered: true
    });
    res.json(message);
  } catch (err) {
    res.status(500).json({ message: 'Failed to send message', error: err.message });
  }
});

// Delete a message (unsend)
router.delete('/messages/:id', protect, async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: 'Message not found' });
    if (String(msg.sender) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to delete this message' });
    }
    await msg.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete message', error: err.message });
  }
});

// Delete a conversation (for all participants)
router.delete('/conversations/:id', protect, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv) return res.status(404).json({ message: 'Conversation not found' });
    if (!conv.participants.some(p => String(p) === String(req.user._id))) {
      return res.status(403).json({ message: 'Not authorized to delete this conversation' });
    }
    // Delete all messages in the conversation
    await Message.deleteMany({ conversation: conv._id });
    await conv.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete conversation', error: err.message });
  }
});

module.exports = router; 