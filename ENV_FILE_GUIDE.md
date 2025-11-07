# .env File Configuration Guide

## ⚠️ Important: NODE_ENV Configuration

### ❌ WRONG - Don't Do This:
```env
NODE_ENV=development
NODE_ENV=production  # ❌ Duplicate! Last value will override
```

### ✅ CORRECT - Do This Instead:

#### For Local Development (.env file):
```env
NODE_ENV=development
```

#### For Production (Render/Vercel):
- **DO NOT** set `NODE_ENV=production` in `.env` file
- Set it in **Render Dashboard** → Your Service → Environment tab
- Add: `NODE_ENV=production`

## Why This Matters?

1. **.env file mein ek hi variable name se do values nahi ho sakti**
   - Last value hi use hogi
   - Agar aapke .env mein dono hai:
     ```env
     NODE_ENV=development
     NODE_ENV=production
     ```
   - To `NODE_ENV=production` hi use hogi (last value)

2. **Development vs Production Setup:**
   - **Local Development**: `.env` file mein `NODE_ENV=development`
   - **Production (Render)**: Render dashboard mein manually set karein `NODE_ENV=production`

## How to Fix Your .env File

### Step 1: Open Your .env File
Location: `backend/.env`

### Step 2: Find Duplicate NODE_ENV
Search for `NODE_ENV` in your file. Agar dono milte hain:
- `NODE_ENV=development`
- `NODE_ENV=production`

### Step 3: Remove One
- **Local development ke liye**: Sirf `NODE_ENV=development` rakhein
- **Production ke liye**: `.env` file se `NODE_ENV=production` hata dein, aur Render dashboard mein set karein

### Step 4: Correct .env File Format

```env
# ==========================================
# Server Configuration
# ==========================================
# For local development - use development
# For production - set in Render dashboard, not here
NODE_ENV=development

# Admin registration access code (required for creating admins)
ADMIN_REGISTRATION_CODE=your_secure_admin_code

PORT=5000

# ==========================================
# Database Configuration
# ==========================================
MONGODB_URI=mongodb://localhost:27017/mv-ecommerce

# ==========================================
# Email Configuration (EMAIL_* format preferred)
# ==========================================
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=your_email@gmail.com
ADMIN_EMAIL=admin@yourdomain.com

# ... rest of your variables
```

## Quick Check Script

Agar aapko check karna hai ki kya aapke .env file mein duplicate variables hain, to yeh command use karein:

```bash
# Windows PowerShell
Get-Content backend\.env | Select-String "^NODE_ENV="

# Linux/Mac
grep "^NODE_ENV=" backend/.env
```

Agar output mein 2 lines aayein, to duplicate hai!

## Best Practices

1. ✅ `.env` file mein sirf development values rakhein
2. ✅ Production values Render dashboard mein set karein
3. ✅ `NODE_ENV` sirf ek baar set karein
4. ✅ Duplicate variables check karein before deploying
5. ✅ `.env.example` file use karein as template (already created)

## Example: Correct .env File Structure

```env
# Development Settings
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/mv-ecommerce

# Email (use EMAIL_* format)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=your_email@gmail.com
ADMIN_EMAIL=admin@yourdomain.com

# ... other variables
```

## Example: Render Dashboard Environment Variables

When deploying to Render, set these in the dashboard:
```
NODE_ENV=production
MONGODB_URI_PROD=mongodb+srv://...
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=your_email@gmail.com
ADMIN_EMAIL=admin@yourdomain.com
FRONTEND_URL_PRODUCTION=https://your-frontend.vercel.app
```

## Troubleshooting

### Problem: "NODE_ENV is production but I set it to development"
**Solution**: Check your .env file - probably `NODE_ENV=production` bhi hai file mein. Last value hi use hogi.

### Problem: "Code is running in development mode on Render"
**Solution**: Render dashboard mein `NODE_ENV=production` set karein.

### Problem: "How do I know which NODE_ENV is being used?"
**Solution**: Check server logs on startup. You'll see:
```
NODE_ENV: production
```
or
```
NODE_ENV: development
```

## Summary

- ❌ **Never** set `NODE_ENV` twice in same file
- ✅ **Local**: `.env` mein `NODE_ENV=development`
- ✅ **Production**: Render dashboard mein `NODE_ENV=production`
- ✅ Use `.env.example` as template (already created for you)

