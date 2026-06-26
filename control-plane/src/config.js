'use strict';

require('dotenv').config();

const PORT = parseInt(process.env.PORT, 10) || 3000;

module.exports = { PORT };