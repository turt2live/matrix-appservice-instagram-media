var DBMigrate = require("db-migrate");
var log = require("./../util/LogService");
var Sequelize = require('sequelize');
var dbConfig = require("../../config/database.json");

/**
 * Primary storage for the Instagram Bridge
 */
class InstagramStore {

    constructor() {
        this._orm = null;
    }

    /**
     * Prepares the store for use
     */
    prepare() {
        var env = process.env.NODE_ENV || "development";
        log.info("InstagramStore", "Running migrations");
        return new Promise((resolve, reject)=> {
            var dbMigrate = DBMigrate.getInstance(true, {
                config: "./config/database.json",
                env: env
            });
            dbMigrate.up().then(() => {
                var dbConfigEnv = dbConfig[env];
                if (!dbConfigEnv) throw new Error("Could not find DB config for " + env);

                var opts = {
                    host: dbConfigEnv.host || 'localhost',
                    dialect: 'sqlite',
                    storage: dbConfigEnv.filename,
                    pool: {
                        max: 5,
                        min: 0,
                        idle: 10000
                    },
                    logging: i => log.verbose("InstagramStore [SQL]", i)
                };

                this._orm = new Sequelize(dbConfigEnv.database || 'instagram', dbConfigEnv.username, dbConfigEnv.password, opts);
                this._bindModels();
            }, err => {
                log.error("InstagramStore", err);
                reject(err);
            }).catch(err => {
                log.error("InstagramStore", err);
                reject(err);
            });
        });
    }

    _bindModels() {
        // Models
        this.__Users = this._orm.import(__dirname + "/models/users");
        this.__UserOAuthTokens = this._orm.import(__dirname + "/models/user_oauth_tokens");
        this.__PendingAuths = this._orm.import(__dirname + "/models/pending_auths");

        // Relationships

        this.__Users.hasMany(this.__UserOAuthTokens, {foreignKey: 'userId', targetKey: 'userId'});
        this.__UserOAuthTokens.belongsTo(this.__Users, {foreignKey: 'userId'});
    }

    /**
     * Saves a pending auth request
     * @param {string} mxId the matrix user ID
     * @param {string} sessionId the session ID
     * @returns {Promise<>} resolves when the auth has been saved
     */
    savePendingAuth(mxId, sessionId) {
        return this.__PendingAuths.create({mxId: mxId, sessionId: sessionId});
    }

    /**
     * Gets the Matrix ID associated with a given session ID
     * @param {string} sessionId the session ID
     * @returns {Promise<String>} resolves to the Matrix User ID for the session, or null if none found
     */
    getMxIdForPendingAuth(sessionId) {
        return this.__PendingAuths.findOne({where: {sessionId: sessionId}}).then(a => a ? a.mxId : null);
    }

    /**
     * Deletes all pending authentication sessions associated with the ID
     * @param {string} sessionId the session ID to delete
     * @returns {Promise<>} resolves when the delete has completed
     */
    deletePendingAuth(sessionId) {
        return this.__PendingAuths.destroy({where: {sessionId: sessionId}});
    }

    /**
     * Gets an Instagram user, creating the user if they don't exist
     * @param {string} username the Instagram username
     * @param {string} accountId the Instagram account ID
     * @returns {Promise<User>} resolves to the found or created user
     */
    getOrCreateUser(username, accountId) {
        return this.__Users.find({where: {accountId: accountId, username: username}}).then(user => {
            if (!user) return this.__Users.create({
                accountId: accountId,
                username: username,
                displayName: username,
                avatarUrl: 'http://i.imgur.com/DQKje5W.png', // instagram icon
                profileExpires: Sequelize.literal("CURRENT_TIMESTAMP")
            });
            else return user;
        }).then(u => new User(u));
    }

    /**
     * Saves an Instagram OAuth token for a user
     * @param {number} userId the user ID
     * @param {string} mxId the Matrix User ID the token is intended for
     * @param {string} token the Instagram auth token
     * @returns {Promise<>} resolves when the token is saved
     */
    saveAuthToken(userId, mxId, token) {
        return this.__UserOAuthTokens.create({
            userId: userId,
            mxId: mxId,
            token: token
        });
    }

    /**
     * Deletes all OAuth tokens for a given Matrix User ID
     * @param {string} mxId the Matrix User ID to delete tokens for
     * @returns {Promise<>} resolves when all of the user's tokens have been deleted
     */
    deleteAuthTokens(mxId) {
        return this.__UserOAuthTokens.destroy({where: {mxId: mxId}});
    }

    /**
     * Deletes all pending auth sessions for a given Matrix User ID
     * @param {string} mxId the Matrix User ID to delete tokens for
     * @returns {Promise<>} resolves when all of the user's pending sessions have been deleted
     */
    deletePendingAuthSessions(mxId) {
        return this.__PendingAuths.destroy({where: {mxId: mxId}});
    }

    /**
     * Gets a random auth token from the database
     * @returns {Promise<string>} resolves to an auth token, or null of none found
     */
    getRandomAuthToken() {
        return this.__UserOAuthTokens.findOne({order: [[Sequelize.fn('RANDOM', '')]]}).then(auth => auth.token);
    }
}

function timestamp(val) {
    if (typeof(val) === 'number') {
        return val;
    } else if (typeof(val) === 'string') {
        return new Date(val).getTime();
    } else return (val || new Date(0)).getTime();
}

class User {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.accountId = dbFields.accountId;
        this.username = dbFields.username;
        this.displayName = dbFields.displayName;
        this.avatarUrl = dbFields.avatarUrl;
        this.profileExpires = timestamp(dbFields.profileExpires);
    }
}

module.exports = new InstagramStore();