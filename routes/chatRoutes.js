const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
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
    const conversations = await Conversation.find({ participants: req.user._id }).populate('participants', 'name email role');
    // For each conversation, count unread messages for this user and get last message
    const unreadCounts = {};
    const lastMessages = {};
    for (const conv of conversations) {
      const count = await Message.countDocuments({
        conversation: conv._id,
        readBy: { $ne: req.user._id },
        sender: { $ne: req.user._id }
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
    const messages = await Message.find({ conversation: req.params.conversationId }).populate('sender', 'name email');
    // Mark all messages as read by this user
    await Message.updateMany(
      { conversation: req.params.conversationId, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch messages', error: err.message });
  }
});

// Start a new conversation (or get existing)
router.post('/conversations', protect, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId is required' });
    let conversation = await Conversation.findOne({ participants: { $all: [req.user._id, userId] } });
    if (!conversation) {
      conversation = await Conversation.create({ participants: [req.user._id, userId] });
    }
    res.json(conversation);
  } catch (err) {
    res.status(500).json({ message: 'Failed to start conversation', error: err.message });
  }
});

// Send a message
router.post('/messages', protect, async (req, res) => {
  try {
    const { conversationId, text } = req.body;
    if (!conversationId) return res.status(400).json({ message: 'conversationId is required' });
    const message = await Message.create({
      conversation: conversationId,
      sender: req.user._id,
      text,
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