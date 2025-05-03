const express = require('express');
const db = require('../db');
const router = express.Router();

// Endpoint para listar todos os serviços ou filtrar por categoria
router.get('/', async (req, res) => {
  const { category } = req.query;  // Parâmetro de categoria na query string

  let query = 'SELECT * FROM services';
  let params = [];

  if (category) {
    query += ' WHERE category = $1';
    params.push(category);
  }

  try {
    const result = await db.query(query, params);
    res.json(result.rows);  // Retorna os serviços filtrados
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao buscar serviços');
  }
});

// Endpoint para criar um novo serviço com categoria
router.post('/', async (req, res) => {
  const { name, price, category } = req.body;
  if (!name || !price || !category) {
    return res.status(400).send('name, price e category são obrigatórios');
  }

  try {
    await db.query(
      'INSERT INTO services (name, price, category) VALUES ($1, $2, $3)',
      [name, price, category]
    );
    res.send('Serviço criado com sucesso');
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao criar serviço');
  }
});

// Endpoint para realizar um serviço, usar artigos e registrar venda
router.post('/:id/use', async (req, res) => {
  const serviceId = req.params.id;

  try {
    const serviceRes = await db.query('SELECT * FROM services WHERE id = $1', [serviceId]);
    if (serviceRes.rows.length === 0) return res.status(404).send('Serviço não encontrado');

    const articlesRes = await db.query('SELECT article_id FROM service_articles WHERE service_id = $1', [serviceId]);
    const articles = articlesRes.rows;

    // Verifica se há artigos suficientes no estoque
    for (let a of articles) {
      const r = await db.query('SELECT quantity FROM articles WHERE id = $1', [a.article_id]);
      if (r.rows.length === 0 || r.rows[0].quantity < 1)
        return res.status(400).send(`Artigo ID ${a.article_id} insuficiente`);
    }

    // Atualiza estoque dos artigos usados
    for (let a of articles) {
      await db.query('UPDATE articles SET quantity = quantity - 1 WHERE id = $1', [a.article_id]);
    }

    // Registra a venda
    await db.query('INSERT INTO sales (service_id) VALUES ($1)', [serviceId]);
    res.send('Serviço executado com sucesso');
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao realizar serviço');
  }
});

// Endpoint para verificar o faturamento total
router.get('/revenue/total', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT SUM(s.price) AS total
      FROM sales sl
      JOIN services s ON s.id = sl.service_id
    `);
    res.json({ total: result.rows[0].total || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao calcular o faturamento');
  }
});

module.exports = router;
