var DBMigrate = require("db-migrate");
var log = require("./../util/LogService");
var Sequelize = require('sequelize');
var dbConfig = require("../../config/database.json");

/**
 * Primary storage for the Instagram Bridge
 */
class InstagramStore {

    /**
     * Creates a new Instagram store. Call `prepare` before use.
     */
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
                resolve();
            }, err => {
                log.error("InstagramStore", err);
                reject(err);
            }).catch(err => {
                log.error("InstagramStore", err);
                reject(err);
            });
        });
    }

    /**
     * Binds all of the models to the ORM.
     * @private
     */
    _bindModels() {
        // Models
        this.__Users = this._orm.import(__dirname + "/models/users");
        this.__UserOAuthTokens = this._orm.import(__dirname + "/models/user_oauth_tokens");
        this.__PendingAuths = this._orm.import(__dirname + "/models/pending_auths");
        this.__UserMedia = this._orm.import(__dirname + "/models/user_media");

        // Relationships

        this.__Users.hasMany(this.__UserOAuthTokens, {foreignKey: 'userId', targetKey: 'userId'});
        this.__UserOAuthTokens.belongsTo(this.__Users, {foreignKey: 'userId'});

        this.__Users.hasMany(this.__UserMedia, {foreignKey: 'userId', targetKey: 'userId'});
        this.__UserMedia.belongsTo(this.__Users, {foreignKey: 'userId'});
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
        return this.__UserOAuthTokens.findOne({order: [[Sequelize.fn('RANDOM')]]}).then(auth => auth.token);
    }

    /**
     * Updates a user's profile information
     * @param {number} userId the user ID to update
     * @param {string} displayName the display name to save
     * @param {string} avatarUrl the avatar url to save
     * @param {number} expirationTime the expiration time for the profile information
     * @returns {Promise<>} resolves when complete
     */
    updateUser(userId, displayName, avatarUrl, expirationTime) {
        return this.__Users.findById(userId).then(user => {
            user.displayName = displayName;
            user.avatarUrl = avatarUrl;
            user.profileExpires = new Date(expirationTime);
            return user.save();
        });
    }

    /**
     * Gets all the known users
     * @returns {Promise<User[]>} resolves to an array of all known users
     */
    listUsers() {
        return this.__Users.findAll().then(users => users.map(u => new User(u)));
    }

    /**
     * Lists all the users that have expired media
     * @returns {Promise<User[]>} resolves to an array of users with expired media
     */
    listUsersWithExpiredMedia() {
        return this.__Users.findAll({
            where: {
                mediaExpirationTime: {
                    $or: [
                        {$lt: Sequelize.literal("datetime(current_timestamp, 'localtime')")},
                        {$eq: null}
                    ]
                }
            }
        }).then(users => users.map(u => new User(u)));
    }

    /**
     * Lists all the users with authentication tokens
     * @returns {Promise<number[]>} resolves to an array of user IDs that have authentication tokens
     */
    listTokenUserIds() {
        return this.__UserOAuthTokens.findAll().then(tokens => {
            var results = [];
            for (var token of tokens) {
                if (results.indexOf(token.userId) === -1) {
                    results.push(token.userId);
                }
            }
            return results;
        });
    }

    /**
     * Updates the media expiration time for a user
     * @param {number} userId the user ID to update
     * @param {number} expirationTime the new expiration time for the user
     * @returns {Promise<>} resolves when complete
     */
    updateMediaExpirationTime(userId, expirationTime) {
        return this.__Users.findById(userId).then(user => {
            user.mediaExpirationTime = new Date(expirationTime);
            return user.save();
        });
    }

    /**
     * Stores a reference to a media event
     * @param {string} userId the user sending the media
     * @param {string} mediaId the media's ID
     * @param {string} mxEventId the matrix event ID
     * @param {string} roomId the room the event occurred in
     * @returns {Promise<>} resolves when completed
     */
    storeMedia(userId, mediaId, mxEventId, roomId) {
        return this.__UserMedia.create({
            userId: userId,
            mxEventId: mxEventId,
            mxRoomId: roomId,
            mediaId: mediaId
        });
    }

    /**
     * Checks if a specific media ID has already been handled
     * @param {string} mediaId the media ID to check
     * @return {Promise<boolean>} resolves to whether or not the media has been handled
     */
    isMediaHandled(mediaId) {
        return this.__UserMedia.findAll({where: {mediaId: mediaId}}).then(media => media && media.length > 0);
    }
}

/**
 * Converts a database value to a millisecond timestamp
 * @param {*} val the value from the database
 * @return {number} a millisecond timestamp representing the date
 */
function timestamp(val) {
    if (typeof(val) === 'number') {
        return val;
    } else if (typeof(val) === 'string') {
        return new Date(val).getTime();
    } else if (!val || !val.getTime) {
        return new Date(0).getTime();
    } else return val;
}

/**
 * Represents a User from the database.
 */
class User {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.accountId = dbFields.accountId;
        this.username = dbFields.username;
        this.displayName = dbFields.displayName;
        this.avatarUrl = dbFields.avatarUrl;
        this.profileExpires = timestamp(dbFields.profileExpires);
        this.mediaExpires = timestamp(dbFields.mediaExpirationTime);
    }
}

module.exports = new InstagramStore();