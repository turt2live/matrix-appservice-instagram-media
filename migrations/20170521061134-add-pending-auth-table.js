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
    return db.createTable("pending_auths", {
        id: {type: 'int', primaryKey: true, autoIncrement: true, notNull: true},
        mxId: {type: 'string', notNull: true},
        sessionId: {type: 'string', notNull: true}
    });
};

exports.down = function (db) {
    return db.dropTable("pending_auths");
};

exports._meta = {
    "version": 1
};
