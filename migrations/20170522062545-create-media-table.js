'use strict';

var dbm;
var type;
var seed;

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 * This enables us to not have to rely on NODE_PATH.
 */
exports.setup = function (options, seedLink) {
    dbm = options.dbmigrate;
    type = dbm.dataType;
    seed = seedLink;
};

exports.up = function (db) {
    return db.createTable("user_media", {
        id: {type: 'int', primaryKey: true, autoIncrement: true, notNull: true},
        userId: {
            type: 'string',
            notNull: true,
            foreignKey: {
                name: 'fk_user_media_user_id_users_id',
                table: 'users',
                mapping: 'id',
                rules: {onDelete: 'CASCADE', onUpdate: 'CASCADE'}
            }
        },
        mediaId: {type: 'string', notNull: true},
        mxEventId: {type: 'string', notNull: true},
        mxRoomId: {type: 'string', notNull: true}
    });
};

exports.down = function (db) {
    return db.dropTable('user_media');
};

exports._meta = {
    "version": 1
};
