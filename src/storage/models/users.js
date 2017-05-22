module.exports = function (sequelize, DataTypes) {
    return sequelize.define('users', {
        id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            field: 'id'
        },
        accountId: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'accountId'
        },
        username: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'username'
        },
        displayName: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'displayName'
        },
        avatarUrl: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'avatarUrl'
        },
        profileExpires: {
            type: DataTypes.TIME,
            allowNull: false,
            field: 'profileExpires'
        },
        mediaExpirationTime: {
            type: DataTypes.TIME,
            allowNull: true,
            field: 'mediaExpirationTime'
        }
    }, {
        tableName: 'users',
        underscored: false,
        timestamps: false
    });
};
