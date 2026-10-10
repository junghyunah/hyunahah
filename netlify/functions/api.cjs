// Netlify's legacy loader calls require(). Keep the entry point CommonJS,
// and load the bundled ES module with import() rather than require().
exports.createHandler = function(options) {
  let handler;
  return async function(event, context) {
    if (!handler) handler = import('../../server-runtime/runtime.mjs')
      .then(runtime => runtime.createNetlifyHandler(options))
      .catch(error => { handler = null; throw error; });
    return (await handler)(event, context);
  };
};
exports.handler = exports.createHandler();
