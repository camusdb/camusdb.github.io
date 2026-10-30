-- Demo data for the documentation screenshots.
-- Fixed ids and values keep every capture identical between runs.
-- Run with: camus-cli shop -f seed.sql (the database must exist).

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS customers;

CREATE TABLE customers (
  id INT64 PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  email STRING NOT NULL,
  country STRING(2) NOT NULL
);

CREATE TABLE products (
  id INT64 PRIMARY KEY NOT NULL,
  sku STRING NOT NULL,
  name STRING NOT NULL,
  price NUMERIC NOT NULL,
  stock INT64 NOT NULL
);

CREATE TABLE orders (
  id INT64 PRIMARY KEY NOT NULL,
  customer_id INT64 NOT NULL REFERENCES customers (id),
  status STRING NOT NULL,
  total NUMERIC NOT NULL
);

CREATE TABLE order_items (
  id INT64 PRIMARY KEY NOT NULL,
  order_id INT64 NOT NULL REFERENCES orders (id),
  product_id INT64 NOT NULL REFERENCES products (id),
  quantity INT64 NOT NULL
);

CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_order_items_order ON order_items (order_id);

INSERT INTO customers (id, name, email, country) VALUES
  (1, 'Ada Lovelace', 'ada@example.com', 'GB'),
  (2, 'Grace Hopper', 'grace@example.com', 'US'),
  (3, 'Alan Turing', 'alan@example.com', 'GB'),
  (4, 'Katherine Johnson', 'katherine@example.com', 'US'),
  (5, 'Edsger Dijkstra', 'edsger@example.com', 'NL'),
  (6, 'Barbara Liskov', 'barbara@example.com', 'US'),
  (7, 'Margaret Hamilton', 'margaret@example.com', 'US'),
  (8, 'Tim Berners-Lee', 'tim@example.com', 'GB');

INSERT INTO products (id, sku, name, price, stock) VALUES
  (1, 'KB-001', 'Mechanical keyboard', 129.00, 42),
  (2, 'MS-002', 'Wireless mouse', 49.50, 120),
  (3, 'MN-003', '27-inch monitor', 349.99, 15),
  (4, 'HD-004', 'USB-C hub', 39.90, 87),
  (5, 'HP-005', 'Noise-cancelling headphones', 219.00, 23),
  (6, 'WC-006', '4K webcam', 89.00, 54);

INSERT INTO orders (id, customer_id, status, total) VALUES
  (1001, 1, 'shipped', 178.50),
  (1002, 2, 'paid', 349.99),
  (1003, 3, 'pending', 39.90),
  (1004, 1, 'paid', 219.00),
  (1005, 4, 'shipped', 258.00),
  (1006, 5, 'cancelled', 89.00),
  (1007, 6, 'paid', 568.99),
  (1008, 7, 'pending', 129.00),
  (1009, 8, 'shipped', 99.00),
  (1010, 2, 'paid', 89.00);

INSERT INTO order_items (id, order_id, product_id, quantity) VALUES
  (1, 1001, 1, 1),
  (2, 1001, 2, 1),
  (3, 1002, 3, 1),
  (4, 1003, 4, 1),
  (5, 1004, 5, 1),
  (6, 1005, 1, 2),
  (7, 1006, 6, 1),
  (8, 1007, 3, 1),
  (9, 1007, 5, 1),
  (10, 1008, 1, 1),
  (11, 1009, 2, 2),
  (12, 1010, 6, 1);

ANALYZE customers;
ANALYZE products;
ANALYZE orders;
ANALYZE order_items;
