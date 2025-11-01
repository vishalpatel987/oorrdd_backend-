const { asyncHandler } = require('../middleware/errorMiddleware');
const Contact = require('../models/Contact');
const sendEmail = require('../utils/sendEmail');

// Create contact form submission
exports.createContact = asyncHandler(async (req, res) => {
  const { name, email, subject, message } = req.body;

  // Validation
  if (!name || !email || !message) {
    return res.status(400).json({ 
      success: false,
      message: 'Name, email, and message are required' 
    });
  }

  // Create contact entry in database
  const contact = await Contact.create({
    name,
    email,
    subject: subject || 'General Inquiry',
    message,
    status: 'new'
  });

  // Admin email - MUST read from .env file (ADMIN_EMAIL variable)
  // This is where admin will receive contact form notifications
  // Priority: ADMIN_EMAIL > CONTACT_ADMIN_EMAIL > default support@mvstore.com
  // NOTE: Do NOT use SMTP_EMAIL as fallback - that's for sending emails, not receiving
  
  // DEBUG: Show all ADMIN_EMAIL related env variables
  console.log('');
  console.log('========================================');
  console.log('🔍 DEBUGGING ADMIN EMAIL FROM .ENV');
  console.log('========================================');
  console.log('process.env.ADMIN_EMAIL:', process.env.ADMIN_EMAIL ? `✅ "${process.env.ADMIN_EMAIL}"` : '❌ NOT SET');
  console.log('process.env.ADMIN_EMAIL (typeof):', typeof process.env.ADMIN_EMAIL);
  console.log('process.env.ADMIN_EMAIL (length):', process.env.ADMIN_EMAIL?.length || 0);
  console.log('process.env.CONTACT_ADMIN_EMAIL:', process.env.CONTACT_ADMIN_EMAIL || 'NOT SET');
  
  // Try to get admin email - strip any whitespace or quotes
  let adminEmailFromEnv = process.env.ADMIN_EMAIL;
  if (adminEmailFromEnv) {
    adminEmailFromEnv = adminEmailFromEnv.trim().replace(/^["']|["']$/g, ''); // Remove quotes if any
    console.log('Cleaned ADMIN_EMAIL:', adminEmailFromEnv);
  }
  
  const adminEmail = adminEmailFromEnv || 
                     (process.env.CONTACT_ADMIN_EMAIL?.trim().replace(/^["']|["']$/g, '')) || 
                     'support@mvstore.com';
  
  console.log('Final adminEmail to use:', adminEmail);
  console.log('========================================');
  console.log('');
  
  // Validate admin email is set from .env
  if (!adminEmailFromEnv && !process.env.CONTACT_ADMIN_EMAIL) {
    console.error('❌❌❌ CRITICAL: ADMIN_EMAIL not set in .env file! ❌❌❌');
    console.error('⚠️  Current adminEmail (using default):', adminEmail);
    console.error('⚠️  To fix: Add this line to backend/.env file:');
    console.error('⚠️  ADMIN_EMAIL=vishalpatel581012@gmail.com');
    console.error('⚠️  Then RESTART the server!');
    console.error('');
  } else {
    console.log('✅✅✅ Admin email found in .env:', adminEmail);
  }
  
  console.log('========================================');
  console.log('📧 Contact Form Submission Received');
  console.log('========================================');
  console.log('👤 User Email (from form):', email);
  console.log('   → Customer will receive confirmation email');
  console.log('📬 Admin Email (notification destination):', adminEmail);
  console.log('   → Admin will receive notification email');
  console.log('');
  
  // Important check: Ensure admin and user emails are different
  if (adminEmail.toLowerCase() === email.toLowerCase()) {
    console.error('❌❌❌ CRITICAL ERROR: Admin email and user email are the same! ❌❌❌');
    console.error('❌ Admin Email:', adminEmail);
    console.error('❌ User Email:', email);
    console.error('❌ This means ADMIN_EMAIL is not properly set in .env file!');
    console.error('❌ Please add ADMIN_EMAIL=your_admin_email@example.com to backend/.env file');
  }
  
  console.log('📋 Environment Variables Status:');
  console.log('   ADMIN_EMAIL:', process.env.ADMIN_EMAIL || '❌ NOT SET');
  console.log('   CONTACT_ADMIN_EMAIL:', process.env.CONTACT_ADMIN_EMAIL || 'NOT SET');
  console.log('   SMTP_EMAIL:', process.env.SMTP_EMAIL || 'NOT SET (used for sending, not receiving)');
  console.log('========================================');
  
  // Helper function to format date safely with non-breaking spaces for mobile email compatibility
  const formatDate = (date) => {
    if (!date) {
      const d = new Date();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours() % 12 || 12).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
      return `${month}/${day}/${year},&nbsp;${hours}:${minutes}:${seconds}&nbsp;${ampm}`;
    }
    try {
      const d = date instanceof Date ? date : new Date(date);
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours() % 12 || 12).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
      // Use non-breaking spaces (&nbsp;) to prevent breaking on mobile
      return `${month}/${day}/${year},&nbsp;${hours}:${minutes}:${seconds}&nbsp;${ampm}`;
    } catch (e) {
      const d = new Date();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours() % 12 || 12).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
      return `${month}/${day}/${year},&nbsp;${hours}:${minutes}:${seconds}&nbsp;${ampm}`;
    }
  };

  // Send email notification to admin (SEPARATE from customer email)
  let adminEmailSent = false;
  try {
    const emailSubject = `New Contact Form Submission: ${subject || 'General Inquiry'}`;
    const submittedDate = formatDate(contact.createdAt || contact.created_at || new Date());
    
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
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f9f9f9;">
        <div style="max-width: 600px; margin: 0 auto; padding: 10px;">
          <div style="background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #3b82f6; margin: 0 0 20px 0; padding-bottom: 10px; border-bottom: 2px solid #3b82f6; font-size: 22px;">
              New Contact Form Submission
            </h2>
            
            <div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <h3 style="color: #333; font-size: 18px; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #d1d5db;">
                Submission Details
              </h3>
              
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                <tr>
                  <td width="120" style="font-weight: bold; color: #333; font-size: 14px; padding: 12px 12px 12px 0; vertical-align: top; width: 120px;">Name:</td>
                  <td style="color: #555; font-size: 15px; padding: 12px 0; word-wrap: break-word; word-break: break-word; line-height: 1.5;">${name}</td>
                </tr>
                <tr>
                  <td width="120" style="font-weight: bold; color: #333; font-size: 14px; padding: 12px 12px 12px 0; vertical-align: top; width: 120px;">Email:</td>
                  <td style="color: #555; font-size: 15px; padding: 12px 0; word-wrap: break-word; word-break: break-word; line-height: 1.5;">
                    <a href="mailto:${email}" style="color: #3b82f6; text-decoration: none; word-wrap: break-word; word-break: break-all; display: inline-block; max-width: 100%;">${email}</a>
                  </td>
                </tr>
                <tr>
                  <td width="120" style="font-weight: bold; color: #333; font-size: 14px; padding: 12px 12px 12px 0; vertical-align: top; width: 120px;">Subject:</td>
                  <td style="color: #555; font-size: 15px; padding: 12px 0; word-wrap: break-word; word-break: break-word; line-height: 1.5;">${subject || 'General Inquiry'}</td>
                </tr>
                <tr>
                  <td width="120" style="font-weight: bold; color: #333; font-size: 14px; padding: 12px 12px 12px 0; vertical-align: top; width: 120px;">Submitted:</td>
                  <td style="color: #555; font-size: 15px; padding: 12px 0; font-family: Arial, sans-serif; line-height: 1.5;">
                    <span style="white-space: nowrap; display: inline-block;">${submittedDate}</span>
                  </td>
                </tr>
                <tr>
                  <td width="120" style="font-weight: bold; color: #333; font-size: 14px; padding: 12px 12px 12px 0; vertical-align: top; width: 120px;">Contact ID:</td>
                  <td style="color: #555; font-size: 14px; padding: 12px 0; line-height: 1.6; word-wrap: break-word; word-break: break-word;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="font-family: 'Courier New', Courier, monospace; font-size: 13px; background-color: #f9f9f9; padding: 10px; border-radius: 4px; border: 1px solid #e5e7eb; word-wrap: break-word; word-break: break-all; letter-spacing: 0.5px; overflow-wrap: break-word; max-width: 100%;">${contact._id}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </div>

            
            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 6px;">
              <h3 style="color: #1e40af; font-size: 18px; margin: 0 0 10px 0; padding-bottom: 10px; border-bottom: 2px solid #3b82f6;">
                Message
              </h3>
              <p style="color: #1e40af; line-height: 1.8; white-space: pre-wrap; margin: 0; word-wrap: break-word; overflow-wrap: break-word;">${message}</p>
            </div>

            <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 6px;">
              <p style="color: #065f46; margin: 0; font-size: 15px; line-height: 1.6;">
                <strong>Action Required:</strong> Please respond to the customer at 
                <a href="mailto:${email}" style="color: #3b82f6; text-decoration: none; font-weight: bold; word-break: break-all; white-space: nowrap;">${email}</a>
              </p>
            </div>

            <p style="color: #555; font-size: 13px; margin: 20px 0 0 0; padding-top: 20px; border-top: 1px solid #e5e7eb; line-height: 1.6;">
              This is an automated notification from MV Store contact form system.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send admin notification email - IMPORTANT: This goes to admin email from .env
    console.log('');
    console.log('========================================');
    console.log('📤 STEP 1: Sending ADMIN Notification Email');
    console.log('========================================');
    console.log('VERIFICATION:');
    console.log('   Admin Email from .env (ADMIN_EMAIL):', process.env.ADMIN_EMAIL || 'NOT SET');
    console.log('   Admin Email to use:', adminEmail);
    console.log('   User Email from form:', email);
    console.log('   Are they different?', adminEmail.toLowerCase() !== email.toLowerCase() ? '✅ YES' : '❌ NO (ERROR!)');
    console.log('');
    console.log('Email Details:');
    console.log('   TO (Admin):', adminEmail);
    console.log('   Subject:', emailSubject);
    
    // CRITICAL: Verify we're sending to admin email, not user email
    if (adminEmail.toLowerCase() === email.toLowerCase()) {
      throw new Error(`CRITICAL: Admin email (${adminEmail}) is same as user email (${email}). Cannot send notification!`);
    }
    
    await sendEmail({
      email: adminEmail,  // CRITICAL: Must be adminEmail, NOT email
      subject: emailSubject,
      message: emailMessage,
      html: htmlContent
    });
    
    adminEmailSent = true;
    console.log('✅✅✅ Admin notification email sent SUCCESSFULLY to:', adminEmail);
    console.log('========================================');

  } catch (adminEmailError) {
    console.error('========================================');
    console.error('❌❌❌ ERROR: Failed to send ADMIN notification email! ❌❌❌');
    console.error('Admin Email Target:', adminEmail);
    console.error('Error:', adminEmailError.message);
    console.error('Error Stack:', adminEmailError.stack);
    console.error('========================================');
    // Continue - try to send customer email even if admin email fails
  }
  
  // Prepare customer confirmation email (OUTSIDE try-catch so it's accessible)
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
                <td>${new Date().toLocaleString()}</td>
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

          <p style="color: #555; font-size: 14px; line-height: 1.6; margin-top: 30px;">
            We appreciate your patience and look forward to assisting you.
          </p>

          <p style="color: #333; font-size: 14px; margin-top: 20px; border-top: 1px solid #e5e7eb; padding-top: 20px;">
            Best Regards,<br/>
            <strong style="color: #3b82f6;">MV Store Support Team</strong>
          </p>
        </div>
      </div>
    `;
  
  // Send customer confirmation email (SEPARATE try-catch)
  try {
    console.log('');
    console.log('========================================');
    console.log('📤 STEP 2: Sending CUSTOMER Confirmation Email');
    console.log('========================================');
    console.log('Customer Email Address:', email);
    console.log('Subject:', customerSubject);
    
    await sendEmail({
      email: email,
      subject: customerSubject,
      message: customerMessage,
      html: customerHtml
    });
    
    console.log('✅✅✅ Customer confirmation email sent SUCCESSFULLY to:', email);
    console.log('========================================');
    
  } catch (customerEmailError) {
    console.error('========================================');
    console.error('❌❌❌ ERROR: Failed to send CUSTOMER confirmation email! ❌❌❌');
    console.error('Customer Email Target:', email);
    console.error('Error:', customerEmailError.message);
    console.error('Error Stack:', customerEmailError.stack);
    console.error('========================================');
    // Don't fail the request - contact entry is still saved
  }
  
  // Final summary
  console.log('');
  console.log('========================================');
  console.log('📧 EMAIL SENDING SUMMARY');
  console.log('========================================');
  console.log('Admin Email Sent:', adminEmailSent ? '✅ YES' : '❌ NO');
  console.log('Admin Email Address:', adminEmail);
  console.log('Customer Email Sent:', '✅ YES (or check error above)');
  console.log('Customer Email Address:', email);
  console.log('========================================');

  res.status(201).json({
    success: true,
    message: 'Thank you for contacting us! We have received your message and will get back to you soon.',
    data: {
      id: contact._id,
      name: contact.name,
      email: contact.email
    }
  });
});

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

          <div style="background-color: #f9fafb; padding: 15px; border-radius: 6px; margin-top: 20px; font-size: 12px; color: #6b7280;">
            <p style="margin: 0;"><strong>Contact Information:</strong></p>
            <p style="margin: 5px 0;">📞 Phone: +91 9038045143</p>
            <p style="margin: 5px 0;">📧 Email: support@mvstore.com</p>
            <p style="margin: 5px 0;">📍 Address: 33, New Alipore, Kolkata 700053</p>
          </div>
        </div>
      </div>
    `;

    await sendEmail({
      email: contact.email,
      subject: replySubject,
      message: replyEmailMessage,
      html: replyHtml
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

