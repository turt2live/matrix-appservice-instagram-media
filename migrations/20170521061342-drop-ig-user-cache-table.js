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
    return db.dropTable("ig_accounts");
};

exports.down = function (db) {
    return db.createTable("ig_accounts", {
        id: {type: 'int', primaryKey: true, autoIncrement: true},
        instagram_username: 'string',
        instagram_user_id: 'string'
    });
};

exports._meta = {
    "version": 1
};
