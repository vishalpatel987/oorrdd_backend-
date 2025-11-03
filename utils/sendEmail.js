const nodemailer = require('nodemailer');
const renderEmailLayout = require('./emailLayout');

function stripHtml(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

const sendEmail = async (options) => {
  const host = process.env.EMAIL_HOST || process.env.SMTP_HOST;
  const port = Number(process.env.EMAIL_PORT || process.env.SMTP_PORT) || 587;
  const user = process.env.EMAIL_USER || process.env.SMTP_EMAIL;
  const pass = process.env.EMAIL_PASS || process.env.SMTP_PASSWORD;

  // Check if SMTP is configured
  if (!host || !user || !pass) {
    const missing = [];
    if (!host) missing.push('SMTP_HOST');
    if (!user) missing.push('SMTP_EMAIL');
    if (!pass) missing.push('SMTP_PASSWORD');
    throw new Error(`Email configuration missing: ${missing.join(', ')}. Please configure SMTP settings in .env file.`);
  }

  // Log email details BEFORE sending
  console.log('📮 sendEmail function called with:');
  console.log('   TO:', options.email);
  console.log('   FROM:', process.env.EMAIL_FROM || user);
  console.log('   SUBJECT:', options.subject);
  console.log('   SMTP HOST:', host);
  console.log('   SMTP USER:', user);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass },
  });

  // Build HTML using a standard brand layout unless explicitly disabled
  const htmlBody = options.rawHtml === true
    ? (options.html || '')
    : renderEmailLayout({
        subject: options.subject,
        title: options.title || options.subject,
        preheader: options.preheader || options.previewText,
        contentHtml: options.html || `<p>${(options.message || '').toString().replace(/\n/g, '<br/>')}</p>`,
        cta: options.cta
      });

  const message = {
    from: process.env.EMAIL_FROM,
    to: options.email,  // recipient email
    subject: options.subject,
    text: options.text || stripHtml(options.message || options.html),
    html: htmlBody,
  };

  // Double verify the email addresses
  console.log('📨 Email message object:');
  console.log('   from:', message.from);
  console.log('   to:', message.to);
  console.log('   subject:', message.subject);

  try {
    const info = await transporter.sendMail(message);
    console.log('✅✅✅ Message sent successfully!');
    console.log('   Message ID:', info.messageId);
    console.log('   Response:', info.response);
    console.log('   Recipient:', options.email);
    console.log('   Environment:', process.env.NODE_ENV || 'development');
    
    // Verify email was actually sent (check response)
    if (!info.messageId) {
      throw new Error('Email sent but no message ID returned');
    }
    
    return info;
  } catch (sendError) {
    console.error('❌ Error sending email:');
    console.error('   Error Type:', sendError.name);
    console.error('   Error Message:', sendError.message);
    console.error('   Error Code:', sendError.code);
    console.error('   Error Response:', sendError.response);
    console.error('   Error Command:', sendError.command);
    console.error('   Environment:', process.env.NODE_ENV || 'development');
    console.error('   SMTP Host:', host);
    console.error('   SMTP User:', user);
    console.error('   To Email:', options.email);
    console.error('   From Email:', message.from);
    
    // Re-throw with more context
    const errorMessage = `Failed to send email to ${options.email}: ${sendError.message}${sendError.code ? ` (Code: ${sendError.code})` : ''}`;
    throw new Error(errorMessage);
  }
};

module.exports = sendEmail;
