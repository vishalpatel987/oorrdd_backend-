const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
  const host = process.env.EMAIL_HOST || process.env.SMTP_HOST;
  const port = Number(process.env.EMAIL_PORT || process.env.SMTP_PORT) || 587;
  const user = process.env.EMAIL_USER || process.env.SMTP_EMAIL;
  const pass = process.env.EMAIL_PASS || process.env.SMTP_PASSWORD;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass },
  });

  const message = {
    from: process.env.EMAIL_FROM,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html,
  };

  const info = await transporter.sendMail(message);
  console.log('✅ Message sent: %s', info.messageId);
};

module.exports = sendEmail;
