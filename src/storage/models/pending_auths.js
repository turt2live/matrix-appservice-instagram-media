module.exports = function (sequelize, DataTypes) {
    return sequelize.define('pending_auths', {
        id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            field: 'id'
        },
        mxId: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'mxId'
        },
        sessionId: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'sessionId'
        }
    }, {
        tableName: 'pending_auths',
        underscored: false,
        timestamps: false
    });
};
