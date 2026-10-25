import { DataTypes, Sequelize } from "sequelize";

export function defineOpsModels(sequelize: Sequelize) {
  const Service = sequelize.define("Service", {
    id: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
    name: { type: DataTypes.STRING(160), allowNull: false },
    description: { type: DataTypes.STRING(500), allowNull: false },
  }, {
    tableName: "services",
    timestamps: false,
  });

  const Alert = sequelize.define("Alert", {
    id: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
    serviceId: { type: DataTypes.STRING(64), allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    severity: {
      type: DataTypes.ENUM("critical", "high", "medium", "low"),
      allowNull: false,
    },
    status: { type: DataTypes.ENUM("firing", "resolved"), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  }, {
    tableName: "alerts",
    timestamps: false,
  });

  const Incident = sequelize.define("Incident", {
    id: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    serviceId: { type: DataTypes.STRING(64), allowNull: false },
    severity: {
      type: DataTypes.ENUM("critical", "high", "medium", "low"),
      allowNull: false,
    },
    status: { type: DataTypes.ENUM("open", "resolved"), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    resolvedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: "incidents",
    timestamps: false,
  });

  Service.hasMany(Alert, { as: "alerts", foreignKey: "serviceId" });
  Alert.belongsTo(Service, { as: "service", foreignKey: "serviceId" });
  Service.hasMany(Incident, { as: "incidents", foreignKey: "serviceId" });
  Incident.belongsTo(Service, { as: "service", foreignKey: "serviceId" });

  return { Service, Alert, Incident };
}
