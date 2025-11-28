const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

function createServer() {
  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
  });

  app.use(express.static('public'));

  return { app, server, io };
}

module.exports = { createServer };
