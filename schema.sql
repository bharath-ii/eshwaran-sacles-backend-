-- Scales Company Admin Database Schema

-- Drop tables if they exist (for clean start)
DROP TABLE IF EXISTS billing_items CASCADE;
DROP TABLE IF EXISTS billings CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS branches CASCADE;
DROP TABLE IF EXISTS admins CASCADE;

-- Branches (Logins)
CREATE TABLE branches (
    id SERIAL PRIMARY KEY,
    username VARCHAR(20) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL, -- "admin123" for all
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Admins (Super Admin)
CREATE TABLE admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Customers and Address
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER REFERENCES branches(id),
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    city VARCHAR(50),
    pincode VARCHAR(10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Inventory Control (Scales, weights, spare parts)
CREATE TABLE inventory (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER REFERENCES branches(id),
    item_name VARCHAR(100) NOT NULL,
    category VARCHAR(50), -- e.g., Electronic Scale, Mechanical Scale, Spare Part
    model_number VARCHAR(50),
    stock_quantity INTEGER DEFAULT 0,
    unit_price DECIMAL(10, 2),
    min_stock_level INTEGER DEFAULT 5,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Billings (Sales)
CREATE TABLE billings (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER REFERENCES branches(id),
    customer_id INTEGER REFERENCES customers(id),
    bill_number VARCHAR(20) UNIQUE NOT NULL,
    bill_date DATE DEFAULT CURRENT_DATE,
    total_amount DECIMAL(15, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    payment_status VARCHAR(20) DEFAULT 'unpaid', -- paid, unpaid, partial
    payment_mode VARCHAR(20), -- cash, card, upi
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Billing Items (Individual items in a bill)
CREATE TABLE billing_items (
    id SERIAL PRIMARY KEY,
    bill_id INTEGER REFERENCES billings(id) ON DELETE CASCADE,
    inventory_id INTEGER REFERENCES inventory(id),
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(15, 2) NOT NULL,
    total_price DECIMAL(15, 2) NOT NULL
);

-- Expenses (Expense handling)
CREATE TABLE expenses (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER REFERENCES branches(id),
    expense_date DATE DEFAULT CURRENT_DATE,
    category VARCHAR(50), -- Rent, Salary, Electricity, Maintenance, Others
    amount DECIMAL(15, 2) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert 5 branches with password 'admin123'
INSERT INTO branches (username, password) VALUES 
('branch1', 'admin123'),
('branch2', 'admin123'),
('branch3', 'admin123'),
('branch4', 'admin123'),
('branch5', 'admin123');

-- Insert default Super Admin (admin / admin123)
INSERT INTO admins (username, password) VALUES ('admin', 'admin123');

