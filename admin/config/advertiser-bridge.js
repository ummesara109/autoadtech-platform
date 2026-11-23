const { randomUUID } = require('crypto');
const supabase = require('./supabase');

function todayIST() {
  return new Date()
    .toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' })
    .slice(0, 10);
}

async function listPendingCampaigns() {
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('*')
    .in('status', ['Pending Approval'])
    .order('submitted_at', { ascending: false });

  if (error) throw error;

  const ownerIds = [...new Set((campaigns || []).map(c => c.owner_id).filter(Boolean))];
  let users = [];

  if (ownerIds.length) {
    const { data, error: userError } = await supabase
      .from('users')
      .select('id, name, email, company')
      .in('id', ownerIds);

    if (userError) throw userError;
    users = data || [];
  }

  const byId = Object.fromEntries(users.map(u => [u.id, u]));

  return (campaigns || []).map(c => ({
    id: c.id,
    name: c.name,
    status: c.status,
    location: c.location,
    autosBooked: c.autos_booked,
    budget: Number(c.budget),
    startDate: c.start_date,
    endDate: c.end_date,
    submittedAt: c.submitted_at,
    owner: byId[c.owner_id] || { id: c.owner_id, name: 'Unknown', email: '', company: '' }
  }));
}

async function decideCampaign(campaignId, decision, rejectionReason = '') {
  const allowed = ['Scheduled', 'Rejected'];
  if (!allowed.includes(decision)) {
    throw new Error('Decision must be Scheduled or Rejected.');
  }

  const { data: campaign, error: readError } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();

  if (readError) throw readError;
  if (!campaign) throw new Error('Campaign not found.');
  if (campaign.status !== 'Pending Approval') {
    throw new Error('Only pending campaigns can be approved or rejected.');
  }

  const decidedAt = todayIST();
  const updates = {
    status: decision,
    decided_at: decidedAt,
    rejection_reason: decision === 'Rejected' ? String(rejectionReason).slice(0, 500) : ''
  };

  const { data: saved, error: updateError } = await supabase
    .from('campaigns')
    .update(updates)
    .eq('id', campaignId)
    .eq('status', 'Pending Approval')
    .select()
    .maybeSingle();

  if (updateError) throw updateError;
  if (!saved) throw new Error('Campaign was already reviewed. Refresh the campaign list.');

  if (decision === 'Scheduled') {
    const { data: existingInvoice, error: invoiceReadError } = await supabase
      .from('invoices')
      .select('id')
      .eq('campaign_id', campaign.id)
      .maybeSingle();

    if (invoiceReadError) throw invoiceReadError;
    if (!existingInvoice) {
      const invoiceId = `inv${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const { error: invoiceError } = await supabase.from('invoices').insert({
        id: invoiceId,
        owner_id: campaign.owner_id,
        campaign_id: campaign.id,
        number: `NIYO-${decidedAt.replace(/-/g, '')}-${invoiceId.slice(-4).toUpperCase()}`,
        issued_at: decidedAt,
        description: `Campaign: ${campaign.name}`,
        amount: Number(campaign.budget),
        status: 'Pending',
        paid_at: null,
        reference: ''
      });

      if (invoiceError) throw invoiceError;
    }
  }

  return saved;
}

async function listVerificationQueue() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, email, company, verification')
    .eq('role', 'Advertiser');

  if (error) throw error;

  return (users || [])
    .filter(u => u.verification?.status === 'under_review')
    .map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    company: u.company,
    verification: u.verification
  }));
}

async function decideVerification(userId, status, note = '') {
  const allowed = ['verified', 'rejected'];
  if (!allowed.includes(status)) {
    throw new Error('Status must be verified or rejected.');
  }

  const { data: user, error: readError } = await supabase
    .from('users')
    .select('id, verification')
    .eq('id', userId)
    .maybeSingle();

  if (readError) throw readError;
  if (!user) throw new Error('Advertiser not found.');

  const verification = {
    ...(user.verification || {}),
    status,
    note: String(note).slice(0, 500),
    decidedAt: todayIST()
  };

  const { data: saved, error: updateError } = await supabase
    .from('users')
    .update({ verification })
    .eq('id', userId)
    .select('id, name, email, company, verification')
    .single();

  if (updateError) throw updateError;
  return saved;
}

module.exports = {
  listPendingCampaigns,
  decideCampaign,
  listVerificationQueue,
  decideVerification
};
