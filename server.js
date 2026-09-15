const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();

// 1. Explicit CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token']
}));

// Handle preflight OPTIONS requests across all routes
app.options('*', cors());

app.use(express.json());

// Database configuration
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
    };

const pool = new Pool(poolConfig);

// Root route (Fixes 'Cannot GET /' in your browser)
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Supreme Credit API is live and running!',
    timestamp: new Date()
  });
});

// Admin Authentication Middleware
const verifyAdminToken = (req, res, next) => {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, message: 'Unauthorized access.' });
  }
  next();
};

// 2. Admin Route: Fetch all loan applications
app.get('/api/admin/applications', verifyAdminToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM applications ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching applications:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Admin Route: Update loan status (Approved/Rejected/Pending)
app.patch('/api/admin/applications/:id', verifyAdminToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const result = await pool.query(
      'UPDATE applications SET status = $1 WHERE application_id = $2 RETURNING *',
      [status, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating status:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Public Loan Application Route
app.post('/api/applications', async (req, res) => {
  const {
    loan_amount,
    repayment_period,
    applicant_name,
    id_number,
    phone_number,
    employment_type,
    monthly_income,
    next_of_kin_name,
    next_of_kin_phone,
  } = req.body;

  const queryText = `
    INSERT INTO applications (
      loan_amount, repayment_period, applicant_name, id_number,
      phone_number, employment_type, monthly_income,
      next_of_kin_name, next_of_kin_phone
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING application_id, created_at;
  `;

  const values = [
    loan_amount,
    repayment_period,
    applicant_name,
    id_number,
    phone_number,
    employment_type,
    monthly_income,
    next_of_kin_name,
    next_of_kin_phone,
  ];

  try {
    const result = await pool.query(queryText, values);
    res.status(201).json({
      success: true,
      message: 'Application recorded successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error executing query:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to record application.',
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Supreme Credit Server running on port ${PORT}`);
});