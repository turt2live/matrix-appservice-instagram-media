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
    return db.dropTable("ig_pending_auth");
};

exports.down = function (db) {
    return db.createTable("ig_pending_auth", {
        id: {type: 'int', primaryKey: true, autoIncrement: true},
        matrix_user_id: 'string',
        session_id: 'string'
    });
};

exports._meta = {
    "version": 1
};
