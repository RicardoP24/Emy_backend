// server.js
const express = require('express');
const cors = require("cors");
const app = express();
const pool = require('./db');
const path = require('path');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());

// Get articles by category
app.get('/api/articles', async (req, res) => {
  const { category } = req.query;
  const result = await pool.query('SELECT * FROM articles WHERE category = $1', [category]);
  res.json(result.rows);
});

// Get services by category
app.get('/api/services', async (req, res) => {
  const { category } = req.query;
  const result = await pool.query('SELECT * FROM services WHERE category = $1', [category]);
  res.json(result.rows);
});

// Add a sale
app.post('/api/sales', async (req, res) => {
  const {
    articleItems,
    serviceItems,
    total,
    exchange,
    paymentCard,
    paymentCash,
    discountType,
    discountValue,
    date // <- nova entrada opcional
  } = req.body;

  const revenue = paymentCash == 0 ? 0 : paymentCash - exchange;

  try {
    let saleResult;

    if (date) {
      // Inserir com data fornecida
      saleResult = await pool.query(
        `INSERT INTO sales 
         (total_price, exchange, revenue, payment_card, payment_cash, discount_type, discount_value, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [total, exchange, revenue, paymentCard, paymentCash, discountType, discountValue, date]
      );
    } else {
      // Inserir usando data atual (padrão do banco)
      saleResult = await pool.query(
        `INSERT INTO sales 
         (total_price, exchange, revenue, payment_card, payment_cash, discount_type, discount_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [total, exchange, revenue, paymentCard, paymentCash, discountType, discountValue]
      );
    }

    const saleId = saleResult.rows[0].id;

    // Inserir artigos
    for (const item of articleItems) {
      await pool.query(
        `INSERT INTO sales_articles (sale_id, article_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
        [saleId, item.id, item.quantity, item.price]
      );
      await pool.query(
        `UPDATE articles SET quantity = quantity - $1 WHERE id = $2`,
        [item.quantity, item.id]
      );
    }

    // Inserir serviços
    for (const item of serviceItems) {
      await pool.query(
        `INSERT INTO sales_services (sale_id, service_id, price)
         VALUES ($1, $2, $3)`,
        [saleId, item.id, item.price]
      );
    }

    res.json({ message: 'Venda registrada com sucesso.' });
  } catch (error) {
    console.error('Erro ao registrar venda:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

 

app.get('/api/sales/by-date/details', async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'Data não fornecida' });
  }

  try {
    const salesResult = await pool.query(`
      SELECT * FROM sales
      WHERE DATE(date) = $1
    `, [date]);

    const sales = [];
    let totalRevenue = 0;
    let totalPaymentCard = 0;
    let totalPaymentCash = 0;
    let totalTotalPrice = 0;

    for (const sale of salesResult.rows) {
      const articlesRes = await pool.query(
        `SELECT a.name, sa.quantity, sa.price
         FROM sales_articles sa
         JOIN articles a ON sa.article_id = a.id
         WHERE sa.sale_id = $1`,
        [sale.id]
      );

      const servicesRes = await pool.query(
        `SELECT s.name, ss.price
         FROM sales_services ss
         JOIN services s ON ss.service_id = s.id
         WHERE ss.sale_id = $1`,
        [sale.id]
      );

      totalRevenue += parseFloat(sale.revenue || 0);
      totalPaymentCard += parseFloat(sale.payment_card || 0);
      totalPaymentCash += parseFloat(sale.payment_cash || 0);
      totalTotalPrice += parseFloat(sale.total_price || 0);

      sales.push({
        id: sale.id,
        date: sale.date,
        total_price: sale.total_price,
        revenue: sale.revenue,
        paymentCard: sale.payment_card,
        paymentCash: sale.payment_cash,
        exchange: sale.exchange,
        discountType: sale.discount_type,
        discountValue: sale.discount_value,
        articles: articlesRes.rows,
        services: servicesRes.rows,
      });
    }

    // Após o loop for
    sales.sort((a, b) => new Date(b.date) - new Date(a.date));


    res.json({
      sales,
      totals: {
        totalRevenue,
        totalPaymentCard,
        totalPaymentCash,
        totalTotalPrice,
      }
    });
  } catch (error) {
    console.error('Erro ao buscar vendas por data:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});



app.get('/api/sales/by-date-range', async (req, res) => {
  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: 'Parâmetros "start" e "end" são obrigatórios.' });
  }

  try {
    const result = await pool.query(`
      SELECT
        SUM(total_price) AS total_price,
        SUM(revenue) AS revenue,
        SUM(payment_card) AS payment_card,
        SUM(payment_cash) AS payment_cash,
        SUM(discount_value) AS total_discount
      FROM sales
      WHERE DATE(date) BETWEEN $1 AND $2
    `, [start, end]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao buscar vendas por intervalo:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

 

app.post('/api/services', async (req, res) => {
  const { name, price } = req.body;
  const category = 'outros'; // Categoria fixa para serviços manuais

  if (!name || price == null) {
    return res.status(400).json({ error: 'Nome e preço são obrigatórios para o serviço.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO services (name, price, category)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, price, category]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao inserir serviço:', error);
    res.status(500).json({ error: 'Erro interno ao registrar serviço.' });
  }
});

app.post('/api/articles', async (req, res) => {
  const { name, price, quantity } = req.body;
  const category = 'outros'; // Categoria fixa para artigos manuais

  if (!name || price == null || quantity == null) {
    return res.status(400).json({ error: 'Nome, preço e quantidade são obrigatórios para o artigo.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO articles (name, quantity, price, category)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, quantity, price, category]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao inserir artigo:', error);
    res.status(500).json({ error: 'Erro interno ao registrar artigo.' });
  }
});



app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
