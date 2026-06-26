'use strict';

require('dotenv').config();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const NAMESPACE = process.env.NAMESPACE || 'default';
const AUDIT_BUFFER_SIZE = parseInt(process.env.AUDIT_BUFFER_SIZE, 10) || 200;

module.exports = { PORT, NAMESPACE, AUDIT_BUFFER_SIZE };