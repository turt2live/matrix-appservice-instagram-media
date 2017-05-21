module.exports = function (sequelize, DataTypes) {
    return sequelize.define('user_oauth_tokens', {
        id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            field: 'id'
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'userId',
            references: {
                model: "users",
                key: "id"
            }
        },
        mxId: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'mxId'
        },
        token: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'token'
        }
    }, {
        tableName: 'user_oauth_tokens',
        underscored: false,
        timestamps: false
    });
};
