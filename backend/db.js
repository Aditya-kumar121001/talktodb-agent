const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'host',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'talktodb'
});

// Connect to the MySQL server
connection.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err.stack);
    return;
  }
  console.log('Connected to the MySQL database as id ' + connection.threadId);
});

module.exports = connection;