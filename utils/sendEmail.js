const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
  const host = process.env.EMAIL_HOST || process.env.SMTP_HOST;
  const port = Number(process.env.EMAIL_PORT || process.env.SMTP_PORT) || 587;
  const user = process.env.EMAIL_USER || process.env.SMTP_EMAIL;
  const pass = process.env.EMAIL_PASS || process.env.SMTP_PASSWORD;

  // Log email details BEFORE sending
  console.log('📮 sendEmail function called with:');
  console.log('   TO:', options.email);
  console.log('   FROM:', process.env.EMAIL_FROM);
  console.log('   SUBJECT:', options.subject);
  console.log('   SMTP HOST:', host);
  console.log('   SMTP USER:', user);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass },
  });

  const message = {
    from: process.env.EMAIL_FROM,
    to: options.email,  // IMPORTANT: This is the recipient email
    subject: options.subject,
    text: options.message,
    html: options.html,
  };

  // Double verify the email addresses
  console.log('📨 Email message object:');
  console.log('   from:', message.from);
  console.log('   to:', message.to);
  console.log('   subject:', message.subject);

  const info = await transporter.sendMail(message);
  console.log('✅✅✅ Message sent successfully!');
  console.log('   Message ID:', info.messageId);
  console.log('   Response:', info.response);
  console.log('   Recipient:', options.email);
};

module.exports = sendEmail;
