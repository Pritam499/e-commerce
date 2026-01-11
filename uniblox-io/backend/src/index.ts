import * as dotenv from "dotenv";
import { buildServer } from "./server";

dotenv.config();

async function start() {
  const server = await buildServer();

  const port = parseInt(process.env.PORT || "3001");
  const host = "0.0.0.0";

  try {
    await server.listen({ port, host });
    console.log(`Server is running on http://${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
