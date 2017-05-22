module.exports = function (sequelize, DataTypes) {
    return sequelize.define('user_media', {
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
        mediaId: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'mediaId'
        },
        mxEventId: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'mxEventId'
        },
        mxRoomId: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'mxRoomId'
        }
    }, {
        tableName: 'user_media',
        underscored: false,
        timestamps: false
    });
};
