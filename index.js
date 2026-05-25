require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware
app.use(cors());
app.use(express.json());

// Request Logging Middleware for debugging
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url} from ${req.ip}`);
    next();
});

// Postgres Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Test DB connection on startup
pool.query('SELECT NOW()')
    .then(() => console.log('✅ Database connected successfully'))
    .catch(err => console.error('❌ Database connection failed:', err.message));

// Auth Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Access denied' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        req.user = user;
        next();
    });
};

const authenticateAdminToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Access denied' });

    jwt.verify(token, JWT_SECRET, (err, admin) => {
        if (err || !admin.isAdmin) return res.status(403).json({ message: 'Invalid or unauthorized token' });
        req.admin = admin;
        next();
    });
};

// --- API ROUTES ---

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`[LOGIN ATTEMPT] Username: ${username}`);

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    try {
        const result = await pool.query('SELECT * FROM branches WHERE username = $1', [username]);
        const branch = result.rows[0];

        if (branch) {
            if (!branch.is_active) {
                return res.status(403).json({ message: 'Your branch account is disabled. Please contact the administrator.' });
            }
            
            console.log(`[LOGIN CHECK] Branch found: ${branch.username}, Password match: ${branch.password === password}`);
            if (branch.password === password) {
                const token = jwt.sign(
                    { id: branch.id, username: branch.username, isAdmin: false },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );
                res.json({
                    token,
                    user: { id: branch.id, username: branch.username }
                });
            } else {
                res.status(401).json({ message: 'Invalid credentials' });
            }
        } else {
            console.log(`[LOGIN CHECK] No branch found with username: ${username}`);
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin Login
app.post('/api/admin/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    try {
        const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
        const admin = result.rows[0];

        if (admin && admin.password === password) {
            const token = jwt.sign(
                { id: admin.id, username: admin.username, isAdmin: true },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            res.json({ token, admin: { id: admin.id, username: admin.username } });
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (err) {
        console.error('Admin login error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin: Get all branches
app.get('/api/admin/branches', authenticateAdminToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, password, is_active, created_at FROM branches ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin: Create a branch
app.post('/api/admin/branches', authenticateAdminToken, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'All fields are required' });
    }
    
    try {
        const result = await pool.query(
            'INSERT INTO branches (username, password, is_active) VALUES ($1, $2, true) RETURNING id, username, password, is_active, created_at',
            [username, password]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') { // Unique constraint violation
            res.status(400).json({ message: 'Username already exists' });
        } else {
            res.status(500).json({ message: 'Server error' });
        }
    }
});

// Admin: Toggle branch status
app.put('/api/admin/branches/:id/toggle', authenticateAdminToken, async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;
    
    try {
        const result = await pool.query(
            'UPDATE branches SET is_active = $1 WHERE id = $2 RETURNING id, username, is_active, created_at',
            [is_active, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Branch not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Dashboard Analytics
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    const branchId = req.user.id;
    try {
        const [sales, expenses, customers, lowStock] = await Promise.all([
            pool.query('SELECT COALESCE(SUM(total_amount), 0) as total FROM billings WHERE branch_id = $1', [branchId]),
            pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE branch_id = $1', [branchId]),
            pool.query('SELECT COUNT(*) as total FROM customers WHERE branch_id = $1', [branchId]),
            pool.query('SELECT COUNT(*) as total FROM inventory WHERE branch_id = $1 AND stock_quantity <= min_stock_level', [branchId])
        ]);

        res.json({
            totalSales: parseFloat(sales.rows[0].total) || 0,
            totalExpenses: parseFloat(expenses.rows[0].total) || 0,
            totalCustomers: parseInt(customers.rows[0].total) || 0,
            lowStockCount: parseInt(lowStock.rows[0].total) || 0
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Billings
app.get('/api/billings', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.*, c.name as customer_name 
            FROM billings b 
            LEFT JOIN customers c ON b.customer_id = c.id 
            WHERE b.branch_id = $1 
            ORDER BY b.bill_date DESC`, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Billings GET error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/billings', authenticateToken, async (req, res) => {
    const { customerId, billNumber, totalAmount, taxAmount, paymentMode, notes, items } = req.body;
    const branchId = req.user.id;

    if (!customerId || !billNumber || !totalAmount || !items || items.length === 0) {
        return res.status(400).json({ message: 'Missing required billing fields' });
    }

    try {
        await pool.query('BEGIN');
        const billRes = await pool.query(
            'INSERT INTO billings (branch_id, customer_id, bill_number, total_amount, tax_amount, payment_mode, notes, payment_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
            [branchId, customerId, billNumber, totalAmount, taxAmount || 0, paymentMode || 'cash', notes || '', 'unpaid']
        );
        const billId = billRes.rows[0].id;

        for (const item of items) {
            await pool.query(
                'INSERT INTO billing_items (bill_id, inventory_id, quantity, unit_price, total_price) VALUES ($1, $2, $3, $4, $5)',
                [billId, item.inventoryId, item.quantity, item.unitPrice, item.totalPrice]
            );
            // Deduct from inventory
            await pool.query(
                'UPDATE inventory SET stock_quantity = stock_quantity - $1 WHERE id = $2',
                [item.quantity, item.inventoryId]
            );
        }
        await pool.query('COMMIT');
        res.status(201).json({ message: 'Billing created', billId });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Billing POST error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Customers
app.get('/api/customers', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM customers WHERE branch_id = $1 ORDER BY name', [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Customers GET error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/customers', authenticateToken, async (req, res) => {
    const { name, phone, email, address, city, pincode } = req.body;
    if (!name) {
        return res.status(400).json({ message: 'Customer name is required' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO customers (branch_id, name, phone, email, address, city, pincode) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [req.user.id, name, phone || '', email || '', address || '', city || '', pincode || '']
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Customer POST error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Inventory
app.get('/api/inventory', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM inventory WHERE branch_id = $1 ORDER BY item_name', [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Inventory GET error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/inventory', authenticateToken, async (req, res) => {
    const { itemName, category, modelNumber, stockQuantity, unitPrice, minStockLevel } = req.body;
    if (!itemName) {
        return res.status(400).json({ message: 'Item name is required' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO inventory (branch_id, item_name, category, model_number, stock_quantity, unit_price, min_stock_level) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [req.user.id, itemName, category || '', modelNumber || '', stockQuantity || 0, unitPrice || 0, minStockLevel || 5]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Inventory POST error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Expenses
app.get('/api/expenses', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM expenses WHERE branch_id = $1 ORDER BY expense_date DESC', [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Expenses GET error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/expenses', authenticateToken, async (req, res) => {
    const { amount, category, description, expense_date } = req.body;
    if (!amount) {
        return res.status(400).json({ message: 'Amount is required' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO expenses (branch_id, amount, category, description, expense_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [req.user.id, amount, category || 'Others', description || '', expense_date || new Date()]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Expenses POST error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Monthly Statements & Balance Sheet
app.get('/api/reports/monthly', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            WITH months AS (
                SELECT generate_series(
                    date_trunc('year', now()), 
                    date_trunc('year', now()) + interval '11 months', 
                    interval '1 month'
                )::date as month_date
            )
            SELECT 
                to_char(m.month_date, 'Mon') as month,
                to_char(m.month_date, 'YYYY-MM') as month_key,
                COALESCE((SELECT SUM(total_amount) FROM billings WHERE branch_id = $1 AND date_trunc('month', bill_date) = m.month_date), 0) as income,
                COALESCE((SELECT SUM(amount) FROM expenses WHERE branch_id = $1 AND date_trunc('month', expense_date) = m.month_date), 0) as expense
            FROM months m
            ORDER BY m.month_date`, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Reports error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Balance Sheet summary
app.get('/api/reports/balance', authenticateToken, async (req, res) => {
    const branchId = req.user.id;
    try {
        const [totalIncome, totalExpense, totalReceivable, inventoryValue] = await Promise.all([
            pool.query('SELECT COALESCE(SUM(total_amount), 0) as total FROM billings WHERE branch_id = $1', [branchId]),
            pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE branch_id = $1', [branchId]),
            pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM billings WHERE branch_id = $1 AND payment_status = 'unpaid'", [branchId]),
            pool.query('SELECT COALESCE(SUM(unit_price * stock_quantity), 0) as total FROM inventory WHERE branch_id = $1', [branchId])
        ]);

        res.json({
            totalIncome: parseFloat(totalIncome.rows[0].total) || 0,
            totalExpense: parseFloat(totalExpense.rows[0].total) || 0,
            netProfit: (parseFloat(totalIncome.rows[0].total) || 0) - (parseFloat(totalExpense.rows[0].total) || 0),
            totalReceivable: parseFloat(totalReceivable.rows[0].total) || 0,
            inventoryValue: parseFloat(inventoryValue.rows[0].total) || 0
        });
    } catch (err) {
        console.error('Balance sheet error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Only listen when running locally (not on Vercel)
if (process.env.VERCEL !== '1') {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
}

// Export for Vercel serverless
module.exports = app;
