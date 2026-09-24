import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const server = createApp().listen(config.PORT);

server.once("listening", () => {
  logger.info({ port: config.PORT }, "api listening");
});

// Without this, a port clash surfaces as an unhandled 'error' event and a raw stack
// trace. A leftover dev server is the usual cause, so say so.
server.once("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(
      { port: config.PORT },
      "port already in use — another server is still running; stop it or set PORT",
    );
  } else {
    logger.error({ err }, "server failed to start");
  }
  process.exit(1);
});
