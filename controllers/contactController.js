const { asyncHandler } = require('../middleware/errorMiddleware');
const Contact = require('../models/Contact');
const sendEmail = require('../utils/sendEmail');

// Create contact form submission
// NOTE: Not using asyncHandler here because we send response immediately
// and handle errors in background async function
exports.createContact = (req, res) => {
  console.log('');
  console.log('========================================');
  console.log('📧 CONTACT FORM REQUEST RECEIVED');
  console.log('========================================');
  console.log('Time:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('URL:', req.originalUrl || req.url);
  console.log('Body:', { name: req.body.name, email: req.body.email, subject: req.body.subject });
  console.log('========================================');
  
  const { name, email, subject, message } = req.body;

  // Validation
  if (!name || !email || !message) {
    console.log('❌ Validation failed - missing required fields');
    return res.status(400).json({ 
      success: false,
      message: 'Name, email, and message are required' 
    });
  }

  // Get admin email from .env file
  let adminEmailFromEnv = process.env.ADMIN_EMAIL;
  if (adminEmailFromEnv) {
    adminEmailFromEnv = adminEmailFromEnv.trim().replace(/^["']|["']$/g, '');
  }
  
  const adminEmail = adminEmailFromEnv || 
                     (process.env.CONTACT_ADMIN_EMAIL?.trim().replace(/^["']|["']$/g, '')) || 
                     'support@mvstore.com';

  // Prepare contact data
  const contactData = {
    name,
    email,
    subject: subject || 'General Inquiry',
    message,
    status: 'new'
  };

  // Generate a temporary ID for immediate response
  const tempContactId = 'temp_' + Date.now();
  
  // Send success response IMMEDIATELY (before database save)
  console.log('✅ Sending success response to frontend IMMEDIATELY (before DB save)...');
  
  try {
    // Send response IMMEDIATELY (res.json() automatically sends and ends)
    res.status(201).json({
      success: true,
      message: 'Thank you for contacting us! We have received your message and will get back to you soon.',
      data: {
        id: tempContactId,
        name: name,
        email: email
      }
    });
    console.log('✅✅✅ Success response sent to frontend - returning immediately');
  } catch (responseError) {
    console.error('Error sending response:', responseError);
    // If response already sent, that's fine
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to process request'
      });
    }
  }

  // NOW save to database and send emails in background (non-blocking)
  // Use setImmediate to ensure response is fully sent before starting background work
  setImmediate(() => {
    (async () => {
    let contact;
    let dbSaveSuccess = false;
    
    try {
      // Try to save to database (with 5 second timeout)
      const savePromise = Contact.create(contactData);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Database save timeout')), 5000);
      });
      
      contact = await Promise.race([savePromise, timeoutPromise]);
      dbSaveSuccess = true;
      console.log('✅ Contact saved to database successfully. ID:', contact._id);
    } catch (dbError) {
      console.error('Database error creating contact:', dbError.message);
      
      // Try to save in background again (one more time)
      try {
        console.log('🔄 Retrying database save in background...');
        contact = await Contact.create(contactData);
        dbSaveSuccess = true;
        console.log('✅ Contact saved in background. ID:', contact._id);
      } catch (retryError) {
        console.error('❌ Background save failed:', retryError.message);
        // Create temp contact for email purposes
        contact = {
          _id: tempContactId,
          ...contactData,
          createdAt: new Date()
        };
      }
    }

    // Prepare emails using saved contact or temp contact
    if (!contact) {
      contact = {
        _id: tempContactId,
        ...contactData,
        createdAt: new Date()
      };
    }

    // Wait a bit to ensure response is fully sent before starting emails
    await new Promise(resolve => setTimeout(resolve, 200));

    // Prepare admin notification email
    const emailSubject = `New Contact Form Submission: ${subject || 'General Inquiry'}`;
    const submittedDate = new Date(contact.createdAt).toLocaleString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    const emailMessage = `
A new contact form submission has been received:

Name: ${name}
Email: ${email}
Subject: ${subject || 'General Inquiry'}

Message:
${message}

---
Submitted: ${submittedDate}
Contact ID: ${contact._id}

Please respond to the customer at: ${email}
    `;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="color: #3b82f6; margin-bottom: 20px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
            New Contact Form Submission
          </h2>
          
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
            <h3 style="color: #333; font-size: 18px; margin-top: 0; border-bottom: 2px solid #d1d5db; padding-bottom: 10px;">
              Submission Details
            </h3>
            <table style="width: 100%; color: #555; line-height: 2;">
              <tr>
                <td style="font-weight: bold; width: 120px;">Name:</td>
                <td>${name}</td>
              </tr>
              <tr>
                <td style="font-weight: bold;">Email:</td>
                <td><a href="mailto:${email}" style="color: #3b82f6; text-decoration: none;">${email}</a></td>
              </tr>
              <tr>
                <td style="font-weight: bold;">Subject:</td>
                <td>${subject || 'General Inquiry'}</td>
              </tr>
              <tr>
                <td style="font-weight: bold;">Submitted:</td>
                <td>${submittedDate}</td>
              </tr>
              <tr>
                <td style="font-weight: bold;">Contact ID:</td>
                <td style="font-family: monospace; font-size: 12px;">${contact._id}</td>
              </tr>
            </table>
          </div>

          <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0; border-radius: 6px;">
            <h3 style="color: #1e40af; font-size: 18px; margin-top: 0; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
              Message
            </h3>
            <p style="color: #1e40af; line-height: 1.8; white-space: pre-wrap; margin: 0;">${message}</p>
          </div>

          <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; border-radius: 6px;">
            <p style="color: #065f46; margin: 0; font-size: 15px; line-height: 1.6;">
              <strong>Action Required:</strong> Please respond to the customer at 
              <a href="mailto:${email}" style="color: #3b82f6; text-decoration: none; font-weight: bold;">${email}</a>
            </p>
          </div>
        </div>
      </div>
    `;

    // Send admin notification email
    let adminEmailSent = false;
    let adminEmailError = null;
    try {
      console.log('');
      console.log('========================================');
      console.log('📤 Sending ADMIN Notification Email');
      console.log('========================================');
      console.log('Environment:', process.env.NODE_ENV || 'development');
      console.log('Admin Email (from .env):', adminEmail);
      console.log('User Email:', email);
      
      // Check Email configuration - SMTP_* format is primary, EMAIL_* is fallback
      const emailHost = process.env.SMTP_HOST || process.env.EMAIL_HOST;
      const emailUser = process.env.SMTP_EMAIL || process.env.EMAIL_USER;
      const emailPass = process.env.SMTP_PASSWORD || process.env.EMAIL_PASS;
      
      console.log('📧 Email Configuration Check (SMTP_* format preferred):');
      console.log('  SMTP_HOST:', process.env.SMTP_HOST ? '✅ SET' : '❌ NOT SET');
      console.log('  EMAIL_HOST (fallback):', process.env.EMAIL_HOST ? '✅ SET' : '❌ NOT SET');
      console.log('  Resolved HOST:', emailHost ? '✅ SET' : '❌ MISSING');
      console.log('');
      console.log('  SMTP_EMAIL:', process.env.SMTP_EMAIL ? '✅ SET' : '❌ NOT SET');
      console.log('  EMAIL_USER (fallback):', process.env.EMAIL_USER ? '✅ SET' : '❌ NOT SET');
      console.log('  Resolved USER:', emailUser ? '✅ SET' : '❌ MISSING');
      console.log('');
      console.log('  SMTP_PASSWORD:', process.env.SMTP_PASSWORD ? '✅ SET' : '❌ NOT SET');
      console.log('  EMAIL_PASS (fallback):', process.env.EMAIL_PASS ? '✅ SET' : '❌ NOT SET');
      console.log('  Resolved PASSWORD:', emailPass ? '✅ SET' : '❌ MISSING');
      
      // Verify admin and user emails are different
      if (adminEmail.toLowerCase() === email.toLowerCase()) {
        console.warn('⚠️ WARNING: Admin email and user email are the same. Skipping admin email.');
        adminEmailError = new Error('Admin and user emails are the same');
      } else if (!emailHost || !emailUser || !emailPass) {
        console.error('❌ Email configuration missing! Cannot send email.');
        console.error('   Please set SMTP_HOST, SMTP_EMAIL, and SMTP_PASSWORD (or EMAIL_* as fallback)');
        adminEmailError = new Error('Email configuration missing');
      } else {
        console.log('Attempting to send email...');
        await sendEmail({
          email: adminEmail,
          subject: emailSubject,
          message: emailMessage,
          html: htmlContent,
          rawHtml: true
        });
        
        adminEmailSent = true;
        console.log('✅✅✅ Admin notification email sent SUCCESSFULLY to:', adminEmail);
      }
      console.log('========================================');
    } catch (emailErr) {
      adminEmailError = emailErr;
      console.error('========================================');
      console.error('❌❌❌ ERROR: Failed to send ADMIN notification email! ❌❌❌');
      console.error('Admin Email Target:', adminEmail);
      console.error('Error Name:', emailErr.name);
      console.error('Error Message:', emailErr.message);
      console.error('Error Stack:', emailErr.stack);
      console.error('Full Error:', JSON.stringify(emailErr, Object.getOwnPropertyNames(emailErr)));
      console.error('========================================');
    }

    // Send customer confirmation email
    const customerSubject = 'Thank You for Contacting MV Store';
    const customerMessage = `
Dear ${name},

Thank you for contacting MV Store! We have received your message and our team will get back to you within 24-48 hours.

Your Inquiry Details:
Subject: ${subject || 'General Inquiry'}

Our team will review your message and respond to you at ${email}.

If you have any urgent queries, please feel free to call us at +91 9038045143 or visit our website.

Best Regards,
MV Store Support Team
    `;

    const customerHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="color: #3b82f6; margin-bottom: 20px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
            Thank You for Contacting MV Store
          </h2>
          
          <p style="color: #333; font-size: 16px; line-height: 1.6;">
            Dear <strong>${name}</strong>,
          </p>
          
          <p style="color: #333; font-size: 16px; line-height: 1.6;">
            Thank you for contacting MV Store! We have received your message and our team will get back to you within <strong>24-48 hours</strong>.
          </p>

          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
            <h3 style="color: #333; font-size: 18px; margin-top: 0; border-bottom: 2px solid #d1d5db; padding-bottom: 10px;">
              Your Inquiry Details
            </h3>
            <table style="width: 100%; color: #555; line-height: 2;">
              <tr>
                <td style="font-weight: bold; width: 100px;">Subject:</td>
                <td>${subject || 'General Inquiry'}</td>
              </tr>
              <tr>
                <td style="font-weight: bold;">Submitted:</td>
                <td>${submittedDate}</td>
              </tr>
            </table>
          </div>

          <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0; border-radius: 6px;">
            <p style="color: #1e40af; margin: 0;">
              Our team will review your message and respond to you at <strong>${email}</strong>.
            </p>
          </div>

          <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; border-radius: 6px;">
            <h3 style="color: #065f46; font-size: 16px; margin-top: 0;">Need Immediate Help?</h3>
            <p style="color: #065f46; margin: 0;">
              If you have any urgent queries, please feel free to call us at <strong>+91 9038045143</strong> or visit our website.
            </p>
          </div>

          <p style="color: #333; font-size: 14px; margin-top: 20px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
            Best Regards,<br/>
            <strong style="color: #3b82f6;">MV Store Support Team</strong>
          </p>
        </div>
      </div>
    `;

    // Send customer confirmation email
    let customerEmailSent = false;
    let customerEmailError = null;
    try {
      console.log('');
      console.log('========================================');
      console.log('📤 Sending CUSTOMER Confirmation Email');
      console.log('========================================');
      console.log('Environment:', process.env.NODE_ENV || 'development');
      console.log('Customer Email:', email);
      
      await sendEmail({
        email: email,
        subject: customerSubject,
        message: customerMessage,
        html: customerHtml,
        rawHtml: true
      });
      
      customerEmailSent = true;
      console.log('✅✅✅ Customer confirmation email sent SUCCESSFULLY to:', email);
      console.log('========================================');
    } catch (emailErr) {
      customerEmailError = emailErr;
      console.error('========================================');
      console.error('❌❌❌ ERROR: Failed to send CUSTOMER confirmation email! ❌❌❌');
      console.error('Customer Email Target:', email);
      console.error('Error Name:', emailErr.name);
      console.error('Error Message:', emailErr.message);
      console.error('Error Stack:', emailErr.stack);
      console.error('========================================');
    }

    // Final summary
    console.log('');
    console.log('========================================');
    console.log('📧 EMAIL SENDING SUMMARY (Background)');
    console.log('========================================');
    console.log('Environment:', process.env.NODE_ENV || 'development');
    console.log('Admin Email Sent:', adminEmailSent ? '✅ YES' : '❌ NO');
    console.log('Admin Email Address:', adminEmail);
    if (adminEmailError) {
      console.error('Admin Email Error:', adminEmailError.message);
    }
    console.log('Customer Email Sent:', customerEmailSent ? '✅ YES' : '❌ NO');
    if (customerEmailError) {
      console.error('Customer Email Error:', customerEmailError.message);
    }
    console.log('Customer Email Address:', email);
    console.log('Contact ID:', contact._id);
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================');
    })();
  });
};

// Admin: Get all contact submissions
exports.getAllContacts = asyncHandler(async (req, res) => {
  const { status = 'all', page = 1, limit = 20 } = req.query;
  
  const query = status === 'all' ? {} : { status };
  
  const contacts = await Contact.find(query)
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Contact.countDocuments(query);

  res.json({
    success: true,
    data: contacts,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// Admin: Get single contact
exports.getContact = asyncHandler(async (req, res) => {
  const contact = await Contact.findById(req.params.id);
  
  if (!contact) {
    return res.status(404).json({
      success: false,
      message: 'Contact submission not found'
    });
  }

  res.json({
    success: true,
    data: contact
  });
});

// Admin: Update contact status
exports.updateContactStatus = asyncHandler(async (req, res) => {
  const { status, adminNotes } = req.body;
  
  const contact = await Contact.findById(req.params.id);
  
  if (!contact) {
    return res.status(404).json({
      success: false,
      message: 'Contact submission not found'
    });
  }

  if (status) {
    contact.status = status;
    if (status === 'replied') {
      contact.repliedAt = new Date();
    }
  }

  if (adminNotes) {
    contact.adminNotes = adminNotes;
  }

  await contact.save();

  res.json({
    success: true,
    message: 'Contact status updated successfully',
    data: contact
  });
});

// Admin: Reply to contact form submission
exports.replyToContact = asyncHandler(async (req, res) => {
  const { replyMessage } = req.body;
  
  if (!replyMessage || !replyMessage.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Reply message is required'
    });
  }

  const contact = await Contact.findById(req.params.id);
  
  if (!contact) {
    return res.status(404).json({
      success: false,
      message: 'Contact submission not found'
    });
  }

  // Send reply email to customer
  try {
    const replySubject = `Re: ${contact.subject || 'Your Inquiry to MV Store'}`;
    
    const replyEmailMessage = `
Dear ${contact.name},

Thank you for contacting MV Store. We have reviewed your inquiry and here is our response:

Original Inquiry:
Subject: ${contact.subject || 'General Inquiry'}

Our Response:
${replyMessage}

If you have any further questions, please feel free to contact us again.

Best Regards,
MV Store Support Team

---
Contact Information:
Phone: +91 9038045143
Email: support@mvstore.com
Address: 33, New Alipore, Kolkata 700053
    `;

    const replyHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="color: #3b82f6; margin-bottom: 20px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
            Response to Your Inquiry
          </h2>
          
          <p style="color: #333; font-size: 16px; line-height: 1.6;">
            Dear <strong>${contact.name}</strong>,
          </p>
          
          <p style="color: #333; font-size: 16px; line-height: 1.6;">
            Thank you for contacting MV Store. We have reviewed your inquiry and here is our response:
          </p>

          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
            <h3 style="color: #333; font-size: 18px; margin-top: 0; border-bottom: 2px solid #d1d5db; padding-bottom: 10px;">
              Original Inquiry
            </h3>
            <table style="width: 100%; color: #555; line-height: 2;">
              <tr>
                <td style="font-weight: bold; width: 100px;">Subject:</td>
                <td>${contact.subject || 'General Inquiry'}</td>
              </tr>
              <tr>
                <td style="font-weight: bold;">Submitted:</td>
                <td>${new Date(contact.createdAt).toLocaleString()}</td>
              </tr>
            </table>
          </div>

          <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0; border-radius: 6px;">
            <h3 style="color: #1e40af; font-size: 18px; margin-top: 0; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
              Our Response
            </h3>
            <p style="color: #1e40af; line-height: 1.8; white-space: pre-wrap; margin: 0;">${replyMessage}</p>
          </div>

          <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; border-radius: 6px;">
            <h3 style="color: #065f46; font-size: 16px; margin-top: 0;">Need More Help?</h3>
            <p style="color: #065f46; margin: 0;">
              If you have any further questions, please feel free to contact us again at 
              <strong>support@mvstore.com</strong> or call us at <strong>+91 9038045143</strong>.
            </p>
          </div>

          <p style="color: #333; font-size: 14px; margin-top: 20px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
            Best Regards,<br/>
            <strong style="color: #3b82f6;">MV Store Support Team</strong>
          </p>
        </div>
      </div>
    `;

    await sendEmail({
      email: contact.email,
      subject: replySubject,
      message: replyEmailMessage,
      html: replyHtml,
      rawHtml: true
    });

    // Update contact status
    contact.status = 'replied';
    contact.repliedAt = new Date();
    contact.adminNotes = replyMessage;
    await contact.save();

    console.log('Reply email sent successfully to customer:', contact.email);

    res.json({
      success: true,
      message: 'Reply sent successfully to customer',
      data: contact
    });

  } catch (emailError) {
    console.error('Error sending reply email:', emailError);
    return res.status(500).json({
      success: false,
      message: 'Failed to send reply email. Please try again.',
      error: emailError.message
    });
  }
});
