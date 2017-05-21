var sqlite3 = require('sqlite3');
var DBMigrate = require('db-migrate');
var log = require("npmlog");

/**
 * Prepares the sqlite3 database
 * @returns {Promise} a promise that resolves to the sqlite3 database
 */
module.exports = function() {
    return new Promise((resolve, reject)=> {
        log.info("Database", "Preparing database");
        var dbMigrate = DBMigrate.getInstance(true, {
            config: "./database.json",
            env: process.env.NODE_ENV || "development"
        });
        dbMigrate.up().then(() => {
            log.info("Database", "Migrated database up");
            var db = new sqlite3.Database("./instagram-" + (process.env.NODE_ENV || "development") + ".db");
            resolve(db);
        }, err=> {
            log.error("Database", "Failed to migrate up");
            log.error("Database", err);
            reject(err);
        });
    });
};