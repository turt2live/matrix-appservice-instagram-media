var log = require("npmlog");
var InstagramAPI = require("instagram-api");

/**
 * Handles Instagram-related actions (such as user ID caching)
 */
class InstagramHandler {

    /**
     * Creates a new Instagram handler backed by sqlite3
     * @param db the sqlite3 database
     */
    constructor(db) {
        this._db = db;
    }

    /**
     * Gets an Instagram API instance
     * @param {String} [mtxUserId] The Matrix user ID to get the API for, if possible
     * @returns {Promise<InstagramAPI>} a promise that resolves to an Instagram API
     */
    getApiInstance(mtxUserId = null) {
        log.info("InstagramHandler - getApiInstance", "Attempting to OAuth token for " + mtxUserId);
        return new Promise((resolve, reject)=> {
            var handleResult = function (error, row) {
                log.info("InstagramHandler - getApiInstance", "Token lookup (error = " + error + ") completed");
                if (error && !mtxUserId) {
                    reject(error);
                    return;
                } else if (error && mtxUserId) {
                    log.info("InstagramHandler - getApiInstance", "Failed to get token for given user, trying to find anyone who has one available");
                    this.getApiInstance(null).then(api => resolve(api), err=>reject(err));
                    return;
                }

                if (!row) {
                    reject(new Error("No authenticated users could be found."));
                    return;
                }

                log.info("InstagramHandler - getApiInstance", "Using auth token for " + row["instagram_username"]);
                resolve(new InstagramAPI(row["instagram_auth_token"]));
            }.bind(this);

            if (mtxUserId) {
                this._db.get("SELECT * FROM ig_auth WHERE matrix_user_id = ?", mtxUserId, handleResult);
            } else {
                this._db.get("SELECT * FROM ig_auth WHERE id IN (SELECT id FROM ig_auth ORDER BY RANDOM() LIMIT 1)", handleResult);
            }
        });
    }

    /**
     * Performs a lookup for the given user's account ID
     * @param {String} username the Instagram username to lookup
     * @returns {Promise<string>} a promise that resolves to the account ID
     */
    getAccountId(username) {
        return new Promise((resolve, reject)=> {
            this._db.get("SELECT * FROM ig_accounts WHERE instagram_username = ?", username, function (error, row) {
                if (error) {
                    log.warn("InstagramHandler - getAccountId", error);
                    reject(error);
                    return;
                }

                if (row) {
                    resolve(row["instagram_user_id"]);
                    return;
                }

                // Ask Instagram for the account ID and cache it
                log.info("InstagramHandler - getAccountId", "ID not known in database. Performing lookup from Instagram");
                this.getApiInstance().then(api => {
                    return api.userSearch(username);
                }).then(results=> {
                    if (results["data"].length !== 1) {
                        log.warn("InstagramHandler - getAccountId", "Too many results for ID lookup. Expected 1 and got " + results["data"].length);
                        reject(new Error("Too many results. Expected 1 got " + results["data"].length));
                        return;
                    }

                    var id = results["data"][0]["id"];
                    this._db.run("INSERT INTO ig_accounts (instagram_username, instagram_user_id) VALUES (?, ?)", username, id, function (generatedId, error) {
                        if (error) {
                            log.error("InstagramHandler - getAccountId", error);
                            reject(error);
                            return;
                        }
                        log.info("InstagramHandler - getAccountId", "Cached username " + username + " as account ID " + id + " (record #" + generatedId + ")");
                        resolve(id);
                    }.bind(this));
                }, err=> {
                    log.error("InstagramHandler - getAccountId", err);
                    reject(err);
                });

            }.bind(this));
        });
    }
}

module.exports = InstagramHandler;
