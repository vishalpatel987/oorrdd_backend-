const Razorpay = require('razorpay');
require('dotenv').config();

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Razorpay Contact
const createContact = async (name, email, contact) => {
  try {
    const contactData = {
      name: name,
      email: email,
      contact: contact,
      type: 'vendor'
    };

    const contactResponse = await razorpay.contacts.create(contactData);
    return contactResponse;
  } catch (error) {
    console.error('Razorpay contact creation error:', error);
    throw new Error(`Contact creation failed: ${error.message}`);
  }
};

// Create Razorpay Fund Account
const createFundAccount = async (contactId, paymentMethod, paymentDetails) => {
  try {
    let fundAccountData = {
      contact_id: contactId,
      account_type: paymentMethod === 'razorpay_upi' ? 'vpa' : 'bank_account'
    };

    if (paymentMethod === 'razorpay_bank') {
      fundAccountData.bank_account = {
        name: paymentDetails.accountHolderName,
        ifsc: paymentDetails.ifscCode,
        account_number: paymentDetails.accountNumber
      };
    } else if (paymentMethod === 'razorpay_upi') {
      fundAccountData.vpa = {
        address: paymentDetails.upiId
      };
    } else if (paymentMethod === 'razorpay_wallet') {
      fundAccountData.wallet = {
        name: paymentDetails.walletType,
        email: paymentDetails.walletId
      };
    }

    const fundAccountResponse = await razorpay.fundAccounts.create(fundAccountData);
    return fundAccountResponse;
  } catch (error) {
    console.error('Razorpay fund account creation error:', error);
    throw new Error(`Fund account creation failed: ${error.message}`);
  }
};

// Create Razorpay Payout
const createPayout = async (fundAccountId, amount, currency = 'INR', purpose = 'payout') => {
  try {
    const payoutData = {
      account_number: process.env.RAZORPAY_ACCOUNT_NUMBER, // Your Razorpay account number
      fund_account_id: fundAccountId,
      amount: amount * 100, // Razorpay expects amount in paise
      currency: currency,
      mode: 'NEFT',
      purpose: purpose,
      queue_if_low_balance: true,
      reference_id: `payout_${Date.now()}`,
      narration: 'MV Store Seller Payout'
    };

    const payoutResponse = await razorpay.payouts.create(payoutData);
    return payoutResponse;
  } catch (error) {
    console.error('Razorpay payout creation error:', error);
    throw new Error(`Payout creation failed: ${error.message}`);
  }
};

// Get Payout Status
const getPayoutStatus = async (payoutId) => {
  try {
    const payout = await razorpay.payouts.fetch(payoutId);
    return payout;
  } catch (error) {
    console.error('Razorpay payout fetch error:', error);
    throw new Error(`Failed to fetch payout status: ${error.message}`);
  }
};

// Get Fund Account Status
const getFundAccountStatus = async (fundAccountId) => {
  try {
    const fundAccount = await razorpay.fundAccounts.fetch(fundAccountId);
    return fundAccount;
  } catch (error) {
    console.error('Razorpay fund account fetch error:', error);
    throw new Error(`Failed to fetch fund account status: ${error.message}`);
  }
};

// Validate Bank Details (Mock validation - in production, use proper bank validation API)
const validateBankDetails = async (accountNumber, ifscCode) => {
  try {
    // This is a mock validation. In production, you should use a proper bank validation service
    // like Razorpay's bank validation API or other third-party services
    
    if (!accountNumber || accountNumber.length < 9) {
      throw new Error('Invalid account number');
    }
    
    if (!ifscCode || ifscCode.length !== 11) {
      throw new Error('Invalid IFSC code');
    }
    
    // Mock validation success
    return {
      valid: true,
      bankName: 'Sample Bank', // In production, this would come from validation API
      message: 'Bank details validated successfully'
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
};

// Validate UPI ID
const validateUpiId = async (upiId) => {
  try {
    // Basic UPI ID validation
    const upiRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z]{3,}$/;
    
    if (!upiId || !upiRegex.test(upiId)) {
      throw new Error('Invalid UPI ID format');
    }
    
    return {
      valid: true,
      message: 'UPI ID validated successfully'
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
};

module.exports = {
  razorpay,
  createContact,
  createFundAccount,
  createPayout,
  getPayoutStatus,
  getFundAccountStatus,
  validateBankDetails,
  validateUpiId
};
