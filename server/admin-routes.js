const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const adminRouter = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const allowedStatuses = new Set(['Pending', 'Approved', 'Rejected']);

function requireAdmin(request, response, next) {
  const token = request.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!process.env.ADMIN_DASHBOARD_TOKEN || token !== process.env.ADMIN_DASHBOARD_TOKEN) {
    return response.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function serializeApplication(row) {
  return {
    id: row.id,
    application_id: row.application_id,
    full_name: row.full_name,
    id_number: row.id_number,
    phone_number: row.phone_number,
    loan_requested: Number(row.loan_requested),
    repayment_period_days: row.repayment_period_days || 10,
    status: row.status || 'Pending',
    created_at: row.created_at
  };
}

adminRouter.get('/applications', requireAdmin, async (request, response) => {
  const { data, error } = await supabase
    .from('applications')
    .select('id, application_id, full_name, id_number, phone_number, loan_requested, repayment_period_days, status, created_at')
    .order('created_at', { ascending: false });
  if (error) return response.status(500).json({ error: 'Could not load applications.' });
  response.json({ applications: data.map(serializeApplication) });
});

adminRouter.patch('/applications/:id', requireAdmin, async (request, response) => {
  const { status } = request.body || {};
  if (!allowedStatuses.has(status)) return response.status(400).json({ error: 'Invalid status.' });
  const { data, error } = await supabase
    .from('applications')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', request.params.id)
    .select('id, application_id, full_name, id_number, phone_number, loan_requested, repayment_period_days, status, created_at')
    .single();
  if (error) return response.status(error.code === 'PGRST116' ? 404 : 500).json({ error: 'Could not update application status.' });
  response.json({ application: serializeApplication(data) });
});

module.exports = adminRouter;
