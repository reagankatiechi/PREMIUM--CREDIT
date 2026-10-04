const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
require('dotenv').config();

// Initialize Express App
const app = express();

// Configure CORS
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (e.g. mobile apps, curl, Postman) or any incoming web origin
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Apply CORS middleware globally (handles OPTIONS preflight automatically)
app.use(cors(corsOptions));

app.use(express.json());

// Initialize Africa's Talking SDK
const africastalking = require('africastalking')({
  apiKey: process.env.AT_API_KEY || '',
  username: process.env.AT_USERNAME || 'sandbox',
});
const sms = africastalking.SMS;

// Initialize Supabase Client safely
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'supreme_secret_key_123';

let supabase;
if (SUPABASE_URL && SUPABASE_KEY && /^https?:\/\//i.test(SUPABASE_URL)) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
  console.warn('Warning: SUPABASE_URL is missing or not a valid HTTP/HTTPS URL.');
}

// Configure Multer for in-memory file handling
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

// Helper: Format Kenyan phone numbers
function formatKenyanPhone(phone) {
  if (!phone) return '';
  let cleaned = phone.toString().replace(/\D/g, '');
  
  if (cleaned.startsWith('0')) {
    return '+254' + cleaned.substring(1);
  } else if (cleaned.startsWith('254')) {
    return '+' + cleaned;
  } else if (cleaned.length === 9) {
    return '+254' + cleaned;
  }
  return '+' + cleaned;
}

// Helper: Upload file buffer to Supabase Storage
async function uploadToSupabase(file, folder, nationalId) {
  if (!supabase) throw new Error('Supabase client is not configured.');

  const fileExt = file.originalname.split('.').pop();
  const fileName = `${folder}/${nationalId}_${Date.now()}.${fileExt}`;

  const { data, error } = await supabase.storage
    .from('USER-UPLOADS')
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: true
    });

  if (error) throw error;

  const { data: publicUrlData } = supabase.storage
    .from('USER-UPLOADS')
    .getPublicUrl(fileName);

  return publicUrlData.publicUrl;
}

// Database Configuration
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
    };

const pool = new Pool(poolConfig);

// Admin Middleware
const verifyAdminToken = (req, res, next) => {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, message: 'Unauthorized access.' });
  }
  next();
};

// ==========================================
// ROUTES
// ==========================================

// Root Health Check
app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: 'Supreme Credit API with Auth & SMS Engine' });
});

// ---------------- AUTH ROUTES ----------------


// USER REGISTRATION (With Image Uploads)
app.post('/api/auth/register', upload.fields([
  { name: 'profilePic', maxCount: 1 },
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 }
]), async (req, res) => {
  const { fullName, nationalId, phone, password } = req.body;
  const files = req.files;

  if (!fullName || !nationalId || !phone || !password) {
    return res.status(400).json({ success: false, message: 'All text fields are required.' });
  }

  if (!files || !files.profilePic || !files.idFront || !files.idBack) {
    return res.status(400).json({ success: false, message: 'Profile picture, ID Front, and ID Back images are required.' });
  }

  try {
    if (!supabase) {
      return res.status(500).json({ success: false, message: 'Supabase client is not configured on the server.' });
    }

    const formattedPhone = formatKenyanPhone(phone);

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Upload images to Supabase Storage
    const profilePicUrl = await uploadToSupabase(files.profilePic[0], 'profile_pics', nationalId);
    const idFrontUrl = await uploadToSupabase(files.idFront[0], 'id_scans', nationalId);
    const idBackUrl = await uploadToSupabase(files.idBack[0], 'id_scans', nationalId);

    // Save user record in Supabase database
    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          full_name: fullName,
          national_id: nationalId,
          phone: formattedPhone,
          password_hash: passwordHash,
          profile_pic_url: profilePicUrl,
          id_front_url: idFrontUrl,
          id_back_url: idBackUrl
        }
      ]);

    if (error) {
      console.error('Supabase DB Insert Error:', error);
      if (error.code === '23505') {
        return res.status(400).json({ success: false, message: 'Phone number or National ID is already registered.' });
      }
      return res.status(400).json({ success: false, message: error.message || 'Database error during registration.' });
    }

    return res.status(201).json({ success: true, message: 'Account registered successfully.' });
  } catch (err) {
    console.error('Registration Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Internal server error during registration.' });
  }
});
// USER LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ message: 'Phone number and password are required.' });
  }

  try {
    const formattedPhone = formatKenyanPhone(phone);

    // Query user in Supabase
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('phone', formattedPhone);

    if (error || !users || users.length === 0) {
      return res.status(400).json({ message: 'Invalid phone number or password.' });
    }

    const user = users[0];

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid phone number or password.' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        phone: user.phone, 
        fullName: user.full_name,
        profilePic: user.profile_pic_url
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        fullName: user.full_name,
        phone: user.phone,
        profilePic: user.profile_pic_url
      }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ message: 'Internal server error during login.' });
  }
});

// ---------------- ADMIN & LOAN ROUTES ----------------

// Fetch Applications
app.get('/api/admin/applications', verifyAdminToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM applications ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fetch Registered Users
app.get('/api/admin/users', verifyAdminToken, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase client is not configured.' });
    }

    const { data: users, error } = await supabase
      .from('users')
      .select('id, full_name, national_id, phone, profile_pic_url, id_front_url, id_back_url, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, count: users.length, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Reset User Password
app.patch('/api/admin/users/:id/reset-password', verifyAdminToken, async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ success: false, message: 'Password must be at least 4 characters long.' });
  }

  try {
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase client is not configured.' });
    }

    // Hash the new password using bcrypt
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update the password_hash in Supabase
    const { data, error } = await supabase
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('id', id)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: 'User record not found.' });
    }

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Password Reset Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH Status Route with Automated SMS Trigger
app.patch('/api/admin/applications/:id', verifyAdminToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const dbResult = await pool.query(
      'UPDATE applications SET status = $1 WHERE application_id = $2 RETURNING *',
      [status, id]
    );

    const application = dbResult.rows[0];

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    if (application.phone_number) {
      const recipientPhone = formatKenyanPhone(application.phone_number);
      const messageBody = `Dear ${application.applicant_name}, your Supreme Credit loan application of KSh ${application.loan_amount} status has been updated to: ${status.toUpperCase()}.`;

      console.log(`Attempting SMS dispatch to: ${recipientPhone}`);

      try {
        const smsResponse = await sms.send({
          to: [recipientPhone],
          message: messageBody,
        });
        console.log('SMS sent successfully:', JSON.stringify(smsResponse));
      } catch (smsError) {
        console.error('Failed to send SMS:', smsError.message || smsError);
      }
    }

    res.json({ success: true, data: application });
  } catch (error) {
    console.error('Error updating status:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Public Application Post
app.post('/api/applications', async (req, res) => {
  const {
    loan_amount, repayment_period, applicant_name, id_number,
    phone_number, employment_type, monthly_income, next_of_kin_name, next_of_kin_phone
  } = req.body;

  const queryText = `
    INSERT INTO applications (
      loan_amount, repayment_period, applicant_name, id_number,
      phone_number, employment_type, monthly_income,
      next_of_kin_name, next_of_kin_phone
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING application_id, created_at;
  `;

  try {
    const result = await pool.query(queryText, [
      loan_amount, repayment_period, applicant_name, id_number,
      phone_number, employment_type, monthly_income, next_of_kin_name, next_of_kin_phone
    ]);
    
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// -------------------------------------------------------------
// JWT AUTHENTICATION MIDDLEWARE
// -------------------------------------------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract token from "Bearer <TOKEN>"

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your_fallback_secret_key', (err, decodedUser) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = decodedUser; // Contains user ID, phone, etc.
    next();
  });
}

app.get('/api/user/dashboard', authenticateToken, async (req, res) => {
  try {
    console.log('Decoded req.user:', req.user);

    // Safely extract name, username, or fallback
    const user = req.user || {};
    const applicantName = user.fullName || user.full_name || user.username || user.name || 'WOLOLO';

    const applicationsQuery = `
      SELECT * FROM applications 
      WHERE applicant_name = $1 
      ORDER BY created_at DESC
    `;

    // Ensure this matches your db/pool client variable name
    const { rows: applications } = await pool.query(applicationsQuery, [applicantName]);

    const latestApp = applications.length > 0 ? applications[0] : null;
    const loanStatus = latestApp ? latestApp.status : 'No Application';
    const activeBalance = (latestApp && (latestApp.status.toUpperCase() === 'APPROVED' || latestApp.status.toUpperCase() === 'DISBURSED'))
      ? Number(latestApp.loan_amount || 0)
      : 0;

    return res.json({
      success: true,
      loanStatus: loanStatus,
      activeBalance: activeBalance,
      latestApplication: latestApp,
      applicationsHistory: applications
    });

  } catch (err) {
    console.error('Dashboard Route Internal Error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve dashboard data', 
      error: err.message 
    });
  }
});
// Start Server bound to 0.0.0.0
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Supreme Credit Server active on port ${PORT}`);
});


// -------------------------------------------------------------
// SAFARICOM M-PESA DARAJA INTEGRATION
// -------------------------------------------------------------

// Helper: Generate Daraja OAuth Access Token
async function getMpesaToken(req, res, next) {
  try {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
      return res.status(500).json({ error: 'M-Pesa Consumer Key or Secret is missing from environment variables.' });
    }

    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const response = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: {
        Authorization: `Basic ${auth}`
      }
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error('Safaricom Auth Failed Response:', responseText);
      return res.status(500).json({ error: 'Failed to authenticate with Safaricom Daraja. Check your Consumer Key/Secret.' });
    }

    const data = JSON.parse(responseText);
    req.mpesaToken = data.access_token;
    next();
  } catch (error) {
    console.error('Error fetching M-Pesa token:', error);
    return res.status(500).json({ error: 'Failed to authenticate with Safaricom Daraja' });
  }
}

// 1. Trigger STK Push Prompt
app.post('/api/mpesa/stkpush', authenticateToken, getMpesaToken, async (req, res) => {
  try {
    const { amount, phone } = req.body;

    if (!amount || !phone) {
      return res.status(400).json({ error: 'Amount and phone number are required.' });
    }

    // Format phone to 254XXXXXXXXX
    let formattedPhone = phone.replace(/[^0-9]/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.substring(1);
    }

    const shortCode = process.env.MPESA_SHORTCODE || '174379';
    const passkey = process.env.MPESA_PASSKEY;
    
    // Generate Timestamp (YYYYMMDDHHmmss)
    const date = new Date();
    const timestamp = date.getFullYear() +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0') +
      String(date.getHours()).padStart(2, '0') +
      String(date.getMinutes()).padStart(2, '0') +
      String(date.getSeconds()).padStart(2, '0');

    // Generate Password: Base64(Shortcode + Passkey + Timestamp)
    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

    const callbackUrl = `${process.env.BASE_URL}/api/mpesa/callback`;

    const stkPayload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: formattedPhone,
      PartyB: shortCode,
      PhoneNumber: formattedPhone,
      CallBackURL: callbackUrl,
      AccountReference: 'SupremeCredit',
      TransactionDesc: 'Loan Repayment'
    };

    const response = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${req.mpesaToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(stkPayload)
    });

    const data = await response.json();

    if (data.ResponseCode === '0') {
      return res.status(200).json({
        success: true,
        message: 'STK Push sent successfully. Check your phone to enter PIN.',
        CheckoutRequestID: data.CheckoutRequestID
      });
    } else {
      return res.status(400).json({
        success: false,
        message: data.ResponseDescription || 'Failed to initiate STK Push.'
      });
    }

  } catch (error) {
    console.error('STK Push Error:', error);
    return res.status(500).json({ error: 'Internal server error processing payment.' });
  }
});

// 2. M-Pesa Callback Webhook (Handles payment response from Safaricom)
app.post('/api/mpesa/callback', async (req, res) => {
  try {
    const callbackData = req.body.Body.stkCallback;
    const resultCode = callbackData.ResultCode;
    const resultDesc = callbackData.ResultDesc;

    if (resultCode === 0) {
      // Payment Successful
      const meta = callbackData.CallbackMetadata.Item;
      const amount = meta.find(item => item.Name === 'Amount')?.Value;
      const mpesaReceipt = meta.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
      const phoneNumber = meta.find(item => item.Name === 'PhoneNumber')?.Value;

      console.log(`Payment Successful: ${mpesaReceipt} | KSh ${amount} | Phone: ${phoneNumber}`);

      // TODO: Update user's active balance in database using Supabase or PostgreSQL Pool
    } else {
      console.log(`Payment Failed/Cancelled: ${resultDesc}`);
    }

    // Always respond to Safaricom with 200 OK
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error) {
    console.error('Callback error:', error);
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted with error' });
  }
});
