const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

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
  console.log(`Supreme Credit Server running on http://localhost:${PORT}`);
});