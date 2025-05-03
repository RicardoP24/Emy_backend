const express = require('express');
const db = require('../db');
const router = express.Router();

// Endpoint para listar os artigos no estoque
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM articles');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao buscar artigos');
  }
});

// Endpoint para ajustar a quantidade de um artigo
router.post('/:id/adjust', async (req, res) => {
  const { delta } = req.body;
  const id = req.params.id;

  try {
    const result = await db.query('SELECT quantity FROM articles WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).send('Artigo não encontrado');

    const newQty = result.rows[0].quantity + delta;
    if (newQty < 0) return res.status(400).send('Quantidade insuficiente');

    await db.query('UPDATE articles SET quantity = $1 WHERE id = $2', [newQty, id]);
    res.send('Quantidade atualizada com sucesso');
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao atualizar quantidade');
  }
});

module.exports = router;
