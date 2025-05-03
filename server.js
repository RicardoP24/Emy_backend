// server.js
const express = require('express');
const cors = require("cors");
const { jsPDF } = require('jspdf');
const fs = require("fs");
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
  const { articleItems, serviceItems, total, paymentCard, paymentCash, exchange } = req.body;

  // Assuming total is the difference between total payment (card + cash) and the total sale amount
  const totalPayment = paymentCard + paymentCash; // Total payment made by the customer
  const revenue = totalPayment - total; // Rename the variable to revenue

  // Insert the sale into the sales table
  const saleResult = await pool.query(
    'INSERT INTO sales (total_price, exchange, revenue, payment_card, payment_cash) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [total, exchange, revenue, paymentCard, paymentCash]
  );

  const saleId = saleResult.rows[0].id;

  // Process the articles and update quantities
  for (const item of articleItems) {
    await pool.query(
      'INSERT INTO sales_articles (sale_id, article_id, quantity, price) VALUES ($1, $2, $3, $4)',
      [saleId, item.id, item.quantity, item.price]
    );
    await pool.query(
      'UPDATE articles SET quantity = quantity - $1 WHERE id = $2',
      [item.quantity, item.id]
    );
  }

  // Process the services
  for (const item of serviceItems) {
    await pool.query(
      'INSERT INTO sales_services (sale_id, service_id, price) VALUES ($1, $2, $3)',
      [saleId, item.id, item.price]
    );
  }

  // Respond back to the frontend
  res.json({ message: 'Sale recorded successfully', saleId: saleId });
});







// Get sales for the last 7 or 30 days
app.get('/api/sales-summary', async (req, res) => {
  let days = parseInt(req.query.days, 10);
  if (![7, 30].includes(days)) days = 7; // default to 7 if invalid

  try {
    const salesResult = await pool.query(`
      SELECT * FROM sales
      WHERE date >= NOW() - INTERVAL '${days} days'
    `);

    const sales = [];

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

      // Push sale data along with paymentCard and paymentCash
      sales.push({
        ...sale,
        articles: articlesRes.rows,
        services: servicesRes.rows,
        paymentCard: sale.payment_card,  // Add paymentCard to the response
        paymentCash: sale.payment_cash,  // Add paymentCash to the response
      });
    }

    res.json({ sales });
  } catch (error) {
    console.error('Error fetching sales summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



 
app.get('/api/download-sales-pdf', async (req, res) => {
  const period = req.query.period; // 'day', 'week', 'month', 'year'

  let dateFilter;
  const currentDate = new Date();

  // Define o filtro de data baseado no período selecionado
  switch (period) {
    case 'day':
      dateFilter = `date >= CURRENT_DATE`;
      break;
    case 'week':
      dateFilter = `date >= CURRENT_DATE - INTERVAL '7 days'`;
      break;
    case 'month':
      dateFilter = `date >= CURRENT_DATE - INTERVAL '30 days'`;
      break;
    case 'year':
      dateFilter = `date >= CURRENT_DATE - INTERVAL '365 days'`;
      break;
    default:
      return res.status(400).send('Período inválido');
  }

  // Busca os dados de vendas no banco
  const salesResult = await pool.query(
    `SELECT * FROM sales WHERE ${dateFilter} ORDER BY date DESC`
  );

  if (salesResult.rows.length === 0) {
    return res.status(404).send('Nenhuma venda encontrada para este período');
  }

  // Criação do PDF
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('Resumo das Vendas', 14, 20);
  doc.setFontSize(12);

  let yPos = 30;  // Posição inicial para o conteúdo no PDF
  let totalSales = 0; // Inicializa a variável para somar o total de vendas

  // Loop através de cada venda
  for (const sale of salesResult.rows) {
    doc.text(`ID da Venda: ${sale.id}`, 14, yPos);
    yPos += 10;

    doc.text(`Total: ${sale.total_price} KZ`, 14, yPos);
    totalSales += parseFloat(sale.total_price); // Soma o valor da venda ao total
    yPos += 10;

    doc.text(`Data: ${new Date(sale.date).toLocaleString()}`, 14, yPos);
    yPos += 15;  // Espaço adicional antes de listar os artigos e serviços

    // Buscar os artigos associados à venda
    const articlesResult = await pool.query(
      'SELECT a.name, sa.quantity, sa.price FROM articles a INNER JOIN sales_articles sa ON a.id = sa.article_id WHERE sa.sale_id = $1',
      [sale.id]
    );

    if (articlesResult.rows.length > 0) {
      doc.text('Artigos:', 14, yPos);  // Exibe o título "Artigos"
      yPos += 10;

      // Loop através dos artigos e adiciona ao PDF
      for (const article of articlesResult.rows) {
        doc.text(
          `${article.name} - Quantidade: ${article.quantity} - Preço: ${article.price} KZ`,
          20,
          yPos
        );
        yPos += 10;
      }
    } else {
      doc.text('Nenhum artigo encontrado para esta venda.', 14, yPos);
      yPos += 10;
    }

    // Buscar os serviços associados à venda
    const servicesResult = await pool.query(
      'SELECT s.name, ss.price FROM services s INNER JOIN sales_services ss ON s.id = ss.service_id WHERE ss.sale_id = $1',
      [sale.id]
    );

    if (servicesResult.rows.length > 0) {
      doc.text('Serviços:', 14, yPos);  // Exibe o título "Serviços"
      yPos += 10;

      // Loop através dos serviços e adiciona ao PDF
      for (const service of servicesResult.rows) {
        doc.text(
          `${service.name} - Preço: ${service.price} KZ`,
          20,
          yPos
        );
        yPos += 10;
      }
    } else {
      doc.text('Nenhum serviço encontrado para esta venda.', 14, yPos);
      yPos += 10;
    }

    // Espaço extra entre vendas diferentes
    yPos += 15;
  }

  // Exibe o total de todas as vendas no final do PDF
  doc.text(`Total de Vendas: ${totalSales.toFixed(2)} KZ`, 14, yPos);

  // Cria um nome de arquivo seguro (removendo caracteres inválidos)
  const sanitizedFilename = `resumo_vendas_${period}_${currentDate.toISOString().slice(0, 10)}.pdf`.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

  // Caminho para salvar o arquivo PDF
  const outputDirectory = path.join(__dirname, 'pdfs');
  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory);
  }

  const filePath = path.join(outputDirectory, sanitizedFilename);

  // Salva o arquivo PDF no diretório
  doc.save(filePath);

  // Envia o arquivo PDF como resposta
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(500).send('Erro ao enviar o arquivo PDF');
    }

    // Opcionalmente, deleta o arquivo depois de enviá-lo
    fs.unlinkSync(filePath);
  });
});



app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
