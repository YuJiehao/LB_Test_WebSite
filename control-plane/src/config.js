'use strict';

require('dotenv').config();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const NAMESPACE = process.env.NAMESPACE || 'default';

module.exports = { PORT, NAMESPACE };