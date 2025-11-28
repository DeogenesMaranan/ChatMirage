try { require('dotenv').config(); } catch (e) { }

const { createServer } = require('./app');
const sessionManager = require('./sessionManager');

const PORT = process.env.PORT || 3000;

const { server, io } = createServer();

sessionManager.init(io);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
