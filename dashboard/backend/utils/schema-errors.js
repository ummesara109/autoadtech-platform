/** Detect Advertiser relational-schema missing / colliding with Admin payload tables. */
function isAdvertiserSchemaError(error) {
  const msg = String(error?.message || error || '');
  return (
    /column .*users\.(email|password_hash|verification)/i.test(msg) ||
    /Could not find the 'address' column of 'users'/i.test(msg) ||
    /Could not find the table 'public\.(users|campaigns|invoices|locations|sessions)'/i.test(
      msg
    ) ||
    (/column .* does not exist/i.test(msg) &&
      /users|campaigns|invoices|locations|sessions/i.test(msg))
  );
}

const ADVERTISER_SCHEMA_MESSAGE =
  'Advertiser database schema is not installed. An admin must run supabase/advertiser_relational_tables.sql once in the Supabase SQL editor (orphan payload users/campaigns conflict with relational tables).';

module.exports = {
  isAdvertiserSchemaError,
  ADVERTISER_SCHEMA_MESSAGE
};
