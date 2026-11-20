const supabase = require('./supabase');

// Uses admin_* tables so we never clash with the advertiser dashboard's
// relational users, campaigns, invoices, and sessions tables in Supabase.
const COLLECTIONS = {
    users: 'admin_users',
    advertisers: 'admin_advertisers',
    partners: 'admin_partners',
    vehicles: 'admin_vehicles',
    devices: 'admin_devices',
    campaigns: 'admin_campaigns',
    inventory: 'admin_inventory',
    billing: 'admin_billing',
    support: 'admin_support',
    audit: 'admin_audit_logs',
    logins: 'admin_logins'
};

const SETTINGS_TABLE = 'admin_app_settings';

async function readTable(table) {
    const { data, error } = await supabase
        .from(table)
        .select('id, payload');

    if (error) throw new Error(`${table}: ${error.message}`);

    return (data || []).map(row => row.payload);
}

async function loadDatabase() {
    const collectionEntries = Object.entries(COLLECTIONS);

    const [collectionRows, settings] = await Promise.all([
        Promise.all(
            collectionEntries.map(async ([key, table]) => [key, await readTable(table)])
        ),
        readTable(SETTINGS_TABLE)
    ]);

    const db = Object.fromEntries(collectionRows);

    db.settings =
        settings.find(item => item.id === 'settings')?.value || {};

    db.meta =
        settings.find(item => item.id === 'meta')?.value || {};

    const hasData = collectionEntries.some(([key]) => (db[key] || []).length > 0);

    return hasData ? db : null;
}

async function saveTable(table, records) {
    const { data: existing, error: readError } = await supabase
        .from(table)
        .select('id');

    if (readError) throw new Error(`${table}: ${readError.message}`);

    const rows = records.map(record => {
        if (record.id === undefined || record.id === null) {
            throw new Error(`A record in ${table} is missing its id`);
        }

        return {
            id: String(record.id),
            payload: record
        };
    });

    const currentIds = rows.map(row => row.id);
    const oldIds = (existing || []).map(row => row.id);
    const deletedIds = oldIds.filter(id => !currentIds.includes(id));

    if (deletedIds.length > 0) {
        const { error } = await supabase
            .from(table)
            .delete()
            .in('id', deletedIds);

        if (error) throw new Error(`${table}: ${error.message}`);
    }

    if (rows.length > 0) {
        const { error } = await supabase
            .from(table)
            .upsert(rows, { onConflict: 'id' });

        if (error) throw new Error(`${table}: ${error.message}`);
    }
}

async function saveDatabase(db, onlyKeys) {
    const keys = onlyKeys && onlyKeys.length
        ? onlyKeys.filter(key => COLLECTIONS[key])
        : Object.keys(COLLECTIONS);

    await Promise.all(
        keys.map(key => saveTable(COLLECTIONS[key], db[key] || []))
    );

    if (!onlyKeys || onlyKeys.includes('settings') || onlyKeys.includes('meta')) {
        const settingsRows = [
            { id: 'settings', value: db.settings || {} },
            { id: 'meta', value: db.meta || {} }
        ].map(item => ({
            id: item.id,
            payload: item
        }));

        const { error } = await supabase
            .from(SETTINGS_TABLE)
            .upsert(settingsRows, { onConflict: 'id' });

        if (error) throw new Error(`${SETTINGS_TABLE}: ${error.message}`);
    }

    console.log('Database saved to Supabase successfully');
}

async function initializeDatabase(initialDatabase) {
    const storedDatabase = await loadDatabase();

    if (storedDatabase) {
        console.log('Loading existing data from Supabase');
        return storedDatabase;
    }

    console.log('Supabase is empty. Migrating existing data...');

    await saveDatabase(initialDatabase);

    return initialDatabase;
}

module.exports = {
    initializeDatabase,
    saveDatabase,
    saveTable,
    COLLECTIONS
};