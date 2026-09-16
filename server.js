const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

// 1. Initialize Africa's Talking SDK
const africastalking = require('africastalking')({
  apiKey: process.env.AT_API_KEY || '',
  username: process.env.AT_USERNAME || 'sandbox', // Use 'sandbox' for testing
});
const sms = africastalking.SMS;

const app = express();

app.use(cors());
app.use(express.json());

// Helper function to format phone numbers to standard E.164 (+254...)
function formatKenyanPhone(phone) {
  if (!phone) return '';
  let cleaned = phone.toString().replace(/\D/g, ''); // Strips all non-digit characters
  
  if (cleaned.startsWith('0')) {
    return '+254' + cleaned.substring(1);
  } else if (cleaned.startsWith('254')) {
    return '+' + cleaned;
  } else if (cleaned.length === 9) {
    return '+254' + cleaned;
  }
  return '+' + cleaned;
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

// Root Health Check
app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: 'Supreme Credit API with SMS Engine' });
});

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
    // 1. Update status in database and retrieve applicant details
    const dbResult = await pool.query(
      'UPDATE applications SET status = $1 WHERE application_id = $2 RETURNING *',
      [status, id]
    );

    const application = dbResult.rows[0];

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    // 2. Dispatch SMS synchronously so execution and errors log to Render immediately
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Supreme Credit Server active on port ${PORT}`);
});