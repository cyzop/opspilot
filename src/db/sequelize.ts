import { Sequelize } from "sequelize";
import { ConfigurationError } from "../domain/errors.ts";

export function createSequelizeFromEnv(env: NodeJS.ProcessEnv = process.env): Sequelize {
  const host = env.MYSQL_HOST?.trim();
  const database = env.MYSQL_DATABASE?.trim();
  const username = env.MYSQL_USER?.trim();
  const password = env.MYSQL_PASSWORD;
  const rawPort = env.MYSQL_PORT?.trim();

  if (!host || !database || !username || !password) {
    throw new ConfigurationError(
      "MySQL configuration requires MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER, and MYSQL_PASSWORD.",
    );
  }
  const port = rawPort === undefined || rawPort === "" ? 3306 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError("MYSQL_PORT must be an integer from 1 to 65535.");
  }

  return new Sequelize(database, username, password, {
    dialect: "mysql",
    host,
    port,
    logging: false,
  });
}
