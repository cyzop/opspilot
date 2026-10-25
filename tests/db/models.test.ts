import assert from "node:assert/strict";
import test from "node:test";
import { Sequelize } from "sequelize";
import { defineOpsModels } from "../../src/../src/db/models.ts";
import { createSequelizeFromEnv } from "../../src/../src/db/sequelize.ts";

test("defines service, alert, and incident attributes and associations without connecting", async () => {
  const sequelize = new Sequelize("ops_pilot_test", "user", "password", {
    dialect: "mysql",
    logging: false,
  });

  test("validates database environment configuration without opening a connection", async () => {
    assert.throws(() => createSequelizeFromEnv({}), /MYSQL_HOST/);
    assert.throws(() => createSequelizeFromEnv({
      MYSQL_HOST: "localhost",
      MYSQL_DATABASE: "ops",
      MYSQL_USER: "ops",
    }), /MYSQL_PASSWORD/);
    assert.throws(() => createSequelizeFromEnv({
      MYSQL_HOST: "localhost",
      MYSQL_DATABASE: "ops",
      MYSQL_USER: "ops",
      MYSQL_PASSWORD: "test-only",
      MYSQL_PORT: "invalid",
    }), /MYSQL_PORT/);

    const sequelize = createSequelizeFromEnv({
      MYSQL_HOST: "localhost",
      MYSQL_DATABASE: "ops",
      MYSQL_USER: "ops",
      MYSQL_PASSWORD: "test-only",
    });
    try {
      assert.equal(sequelize.config.port, 3306);
    } finally {
      await sequelize.close();
    }
  });

  try {
    const { Service, Alert, Incident } = defineOpsModels(sequelize);
    assert.ok(Service.getAttributes().id);
    assert.ok(Service.getAttributes().name);
    assert.ok(Alert.getAttributes().serviceId);
    assert.ok(Alert.getAttributes().status);
    assert.ok(Alert.getAttributes().severity);
    assert.ok(Incident.getAttributes().serviceId);
    assert.ok(Incident.getAttributes().resolvedAt);
    assert.ok(Service.associations.alerts);
    assert.ok(Service.associations.incidents);
    assert.ok(Alert.associations.service);
    assert.ok(Incident.associations.service);
  } finally {
    await sequelize.close();
  }
});
