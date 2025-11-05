# Environment Variables Setup

Add these environment variables to your `.env` file in the backend directory:

```env
# Database Configuration
MONGODB_URI=mongodb://localhost:27017/mv-ecommerce

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRE=30d

# Server Configuration
PORT=5000
NODE_ENV=development

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000
FRONTEND_URL_PRODUCTION=https://your-domain.com

# Cloudinary Configuration (for image uploads)
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# Email Configuration (for notifications)
EMAIL_FROM=noreply@mvstore.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_EMAIL=your_email@gmail.com
SMTP_PASSWORD=your_app_password

# Admin Email (where contact form notifications will be sent)
ADMIN_EMAIL=admin@mvstore.com

# Razorpay Configuration (for online payments and payouts)
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_ACCOUNT_NUMBER=your_razorpay_account_number

# Stripe Configuration (alternative payment)
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

# Google Translate API (for multi-language support)
GOOGLE_TRANSLATE_API_KEY=your_google_translate_api_key

# OpenAI API (for AI features)
OPENAI_API_KEY=your_openai_api_key

# Google Generative AI
GOOGLE_GENERATIVE_AI_API_KEY=your_google_generative_ai_api_key

# RapidShyp Configuration (for shipping and delivery)
RAPIDSHYP_BASE_URL=https://api.rapidshyp.com/rapidshyp/apis/v1
RAPIDSHYP_API_KEY=your_rapidshyp_api_key
RAPIDSHYP_CLIENT_ID=your_rapidshyp_client_id
```

## Razorpay Setup Instructions:

### For Payments:
1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Create an account or login
3. Go to Settings > API Keys
4. Generate Test/Live API Keys
5. Copy the Key ID and Key Secret
6. Add them to your `.env` file as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`

### For Payouts (Wallet Withdrawals):
1. Enable Payouts in your Razorpay dashboard
2. Go to Settings > Payouts
3. Get your Account Number from the dashboard
4. Add it to your `.env` file as `RAZORPAY_ACCOUNT_NUMBER`
5. Complete KYC if required for payouts

## RapidShyp Setup Instructions:
1. Go to [RapidShyp Dashboard](https://rapidshyp.com/)
2. Create an account or login
3. Navigate to Settings > API > Configure
4. Or go to: Home > Settings > Api Configuration > Generate New Api Key
5. Generate your API Key with appropriate scope (Read & Write recommended)
6. Optionally configure Whitelist IP addresses (up to 5 IPs)
7. Copy the generated API Key
8. Add it to your `.env` file as `RAPIDSHYP_API_KEY`
9. Configure webhook URL in RapidShyp dashboard: `https://your-domain.com/api/webhooks/rapidshyp`
10. RapidShyp will automatically update order tracking status via webhooks

**Note:** The `RAPIDSHYP_CLIENT_ID` is optional and may not be required depending on your RapidShyp plan.

## Email Configuration for Production (Render/Vercel)

### For Gmail SMTP:
1. **Generate App Password** (NOT your regular password):
   - Go to https://myaccount.google.com/
   - Security → 2-Step Verification → App passwords
   - Create app password for "Mail"
   - Use the 16-character password (no spaces)

2. **Set in Render Dashboard**:
   - Go to your service → Environment tab
   - Add all SMTP variables:
     ```
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=587
     SMTP_EMAIL=your_email@gmail.com
     SMTP_PASSWORD=your_16_char_app_password
     EMAIL_FROM=your_email@gmail.com
     ADMIN_EMAIL=admin@yourdomain.com
     NODE_ENV=production
     ```

3. **Alternative SMTP Providers** (if Gmail blocks):
   - SendGrid, Mailgun, or AWS SES
   - See `DEPLOYMENT_SMTP_SETUP.md` for details

### Troubleshooting Email Issues:
- **EAUTH Error**: Wrong password or not using App Password
- **ECONNECTION Error**: Check host/port or firewall
- **ESOCKET Error**: TLS certificate issue (set `SMTP_REJECT_UNAUTHORIZED=false` if needed)
- See `DEPLOYMENT_SMTP_SETUP.md` for complete troubleshooting guide

## Important Notes:
- Use test keys for development
- Use live keys for production
- Keep your keys secure and never commit them to version control
- The `.env` file should be in your `.gitignore`
- **For Render**: Set environment variables in the dashboard, not in `.env` file
- **After setting env vars**: Always redeploy your service for changes to take effect
