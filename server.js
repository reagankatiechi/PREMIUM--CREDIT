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

// Configure CORS to explicitly allow GitHub Pages and local development
app.use(cors({
  origin: '*', // Allows requests from GitHub Pages & local test environments
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token']
}));

app.use(express.json());

// Initialize Africa's Talking SDK
const africastalking = require('africastalking')({
  apiKey: process.env.AT_API_KEY || '',
  username: process.env.AT_USERNAME || 'sandbox',
});
const sms = africastalking.SMS;

// Initialize Supabase Client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'supreme_secret_key_123';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
    return res.status(400).json({ message: 'All text fields are required.' });
  }

  if (!files || !files.profilePic || !files.idFront || !files.idBack) {
    return res.status(400).json({ message: 'Profile picture, ID Front, and ID Back images are required.' });
  }

  try {
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
      if (error.code === '23505') {
        return res.status(400).json({ message: 'Phone number or National ID is already registered.' });
      }
      throw error;
    }

    res.status(201).json({ success: true, message: 'Account registered successfully.' });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ message: err.message || 'Internal server error during registration.' });
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

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Supreme Credit Server active on port ${PORT}`);
});