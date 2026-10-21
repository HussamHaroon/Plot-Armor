/* ReliefHub mock API — json-server as a library so it binds the host/port a
 * cloud host provides ($PORT on Render etc.) instead of hardcoded localhost.
 * Data lives in db.json next to this file; on free hosts the filesystem is
 * ephemeral, so mutations persist until the service restarts and then reset
 * to the seed - which suits a public demo just fine. */
const path = require('path');
const jsonServer = require('json-server');

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, 'db.json'));
const middlewares = jsonServer.defaults(); // logger, CORS, static

server.use(middlewares);
server.use(router);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`reliefhub mock api listening on ${PORT}`);
});
