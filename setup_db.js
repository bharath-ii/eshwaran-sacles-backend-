const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://neondb_owner:npg_mLyqiX7pduQ8@ep-little-fog-ai8ifjgv-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

async function setup() {
    const client = new Client({
        connectionString: connectionString,
    });

    try {
        await client.connect();
        console.log('Connected to Neon PostgreSQL database.');

        const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        console.log('Executing SQL schema...');
        
        await client.query(sql);
        console.log('Tables created successfully and initial branch data inserted.');

    } catch (err) {
        console.error('Error during setup:', err);
    } finally {
        await client.end();
    }
}

setup();
