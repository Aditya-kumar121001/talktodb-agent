require('dotenv').config();
const connection = require('./db');
const { parse } = require('csv-parse');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { promisify } = require('util');
const { Pinecone } = require('@pinecone-database/pinecone');
const express = require('express');
const app = express();

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Configuration
const csvFile = 'movies.csv';
const tableName = 'movies';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

const pineconeConfig = {
  similarityQuery: {
    topK: 1,
    includeValues: false,
    includeMetadata: true,
  },
  indexName: 'talktodb-agent',
  embeddingID: 'Question',
  dimension: 768,
  metric: 'cosine',
  cloud: 'aws',
  region: 'us-west-2'
};

const query = promisify(connection.query).bind(connection);

// Embedding Generation
async function getEmbedding(text) {
  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent({
      content: { parts: [{ text }] },
    });
    if (!result || !result.embedding || !Array.isArray(result.embedding.values)) {
      throw new Error('Embedding generation failed. Unexpected response format.');
    }
    return result.embedding.values;
  } catch (error) {
    console.error(`Error generating embedding: ${error.message}`);
    return null;
  }
}

// Pinecone Index Management
async function manageIndex(action) {
  const indexExists = (await pc.listIndexes()).indexes.some(index => index.name === pineconeConfig.indexName);

  if (action === 'create') {
    if (indexExists) {
      console.log(`Index '${pineconeConfig.indexName}' already exists.`);
    } else {
      await pc.createIndex({
        name: pineconeConfig.indexName,
        dimension: pineconeConfig.dimension,
        metric: pineconeConfig.metric,
        spec: { serverless: { cloud: pineconeConfig.cloud, region: pineconeConfig.region } },
      });
      console.log(`Index '${pineconeConfig.indexName}' created.`);
    }
  } else if (action === 'delete') {
    if (indexExists) {
      await pc.deleteIndex(pineconeConfig.indexName);
      console.log(`Index '${pineconeConfig.indexName}' deleted.`);
    } else {
      console.log(`Index '${pineconeConfig.indexName}' does not exist.`);
    }
  }
}

// Data Ingestion
async function csvToMySQL() {
  try {
    await manageIndex('create');

    const csvData = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(csvFile)
        .pipe(parse({ columns: true, trim: true }))
        .on('data', (row) => csvData.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    if (csvData.length === 0) throw new Error('CSV file is empty');

    const sampleRow = csvData[0];
    const columns = Object.keys(sampleRow).map(col => {
      const value = sampleRow[col];
      let type = 'TEXT';
      if (!isNaN(value) && value !== '' && Number.isInteger(parseFloat(value))) type = 'INTEGER';
      else if (!isNaN(value) && value !== '') type = 'FLOAT';
      return `\`${col}\` ${type}`;
    });
    const schema = columns.join(', ');

    await query(`DROP TABLE IF EXISTS ${tableName}`);
    await query(`CREATE TABLE ${tableName} (${schema})`);
    console.log(`Table '${tableName}' created with schema: ${schema}`);

    const columnNames = Object.keys(sampleRow).map(col => `\`${col}\``).join(', ');
    const placeholders = Object.keys(sampleRow).map(() => '?').join(', ');
    const insertQuery = `INSERT INTO ${tableName} (${columnNames}) VALUES (${placeholders})`;

    for (const row of csvData) {
      const values = Object.values(row).map(val => (val === '' ? null : val));
      await query(insertQuery, values);
    }

    console.log(`Data loaded into '${tableName}' in MySQL`);
  } catch (error) {
    console.error(`Error during data ingestion: ${error.message}`);
    throw error;
  }
}

// Schema Retrieval
async function getTableSchema() {
  try {
    const results = await query(`
      SELECT COLUMN_NAME AS name, DATA_TYPE AS type
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = ?`, [tableName]);
    return results.map(row => ({
      name: row.name,
      type: row.type.toUpperCase()
    }));
  } catch (error) {
    console.error(`Error retrieving schema: ${error.message}`);
    return [];
  }
}

// LLM Prompt Generator
function generateLLMPrompt(schema) {
  let prompt = `You are an expert in writing SQL queries for relational databases.
The database has a table named '${tableName}' with the following schema:\n\nColumns:\n`;
  schema.forEach(col => prompt += `- ${col.name} (${col.type})\n`);
  prompt += '\nPlease generate a SQL query based on the following natural language question. ONLY return the SQL query with the desired select columns.';
  return prompt;
}

// SQL Query Generator 
async function generateSQLQuery(question) {
  try {
    const schema = await getTableSchema();
    if (schema.length === 0) throw new Error('Failed to retrieve schema');
    const llmPrompt = generateLLMPrompt(schema);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(`${llmPrompt}\n\nQuestion: ${question}`);
    let query = result.response.text().trim();
    query = query.replace(/```sql/g, '').replace(/```/g, '').trim();
    console.log(`Generated SQL: ${query}`);
    return query;
  } catch (error) {
    console.error(`Error generating SQL query: ${error.message}`);
    return '';
  }
}

// MySQL Query Runner
async function runSQLQuery(sqlQuery) {
  try {
    console.log(`Executing SQL: ${sqlQuery}`);
    const results = await query(sqlQuery);
    return results.length ? results : [];
  } catch (error) {
    console.error(`Error executing query: ${error.message}`);
    return [];
  }
}

// Cache Search and Storage
async function searchCache(questionEmbedding) {
  const index = pc.index(pineconeConfig.indexName);
  try {
    const queryResult = await index.query({
      ...pineconeConfig.similarityQuery,
      vector: questionEmbedding,
    });
    if (queryResult.matches.length > 0 && queryResult.matches[0].score > 0.95) {
      return JSON.parse(queryResult.matches[0].metadata.response);
    }
    return null;
  } catch (error) {
    console.error(`Error searching cache: ${error.message}`);
    return null;
  }
}

// Handle User Question
async function handleUserQuestion(question) {
  const index = pc.index(pineconeConfig.indexName);
  try {
    const questionEmbedding = await getEmbedding(question);
    if (!questionEmbedding) throw new Error('Failed to generate question embedding');

    const cachedResponse = await searchCache(questionEmbedding);
    if (cachedResponse) {
      console.log('Cache hit!');
      console.log(cachedResponse)
      return cachedResponse;
    }

    console.log('Cache miss! Generating SQL...');
    const sqlQuery = await generateSQLQuery(question);
    if (!sqlQuery) throw new Error('No SQL query generated');
    const response = await runSQLQuery(sqlQuery);
    console.log("inserting query")
    await index.upsert([{
      id: `${pineconeConfig.embeddingID}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      values: questionEmbedding,
      metadata: { question, sqlQuery, response: JSON.stringify(response) }
    }]);
    console.log(response)
    return response;
  } catch (error) {
    console.error(`Error handling question: ${error.message}`);
    return [];
  }
}

// API 
app.post('/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    const result = await handleUserQuestion(question);
    res.json({ result });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/schema', async (req, res) => {
  try {
    const schema = await getTableSchema();
    res.json({ schema });
  } catch (error) {
    console.error('Schema fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch schema' });
  }
});

// Server
(async () => {
  try {
    await csvToMySQL();
    app.listen(3000, () => {
      console.log('Server running on http://localhost:3000');
    });
  } catch (error) {
    console.error('Startup error:', error);
    connection.end();
  }
})();