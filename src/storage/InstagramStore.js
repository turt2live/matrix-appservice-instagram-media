var DBMigrate = require("db-migrate");
var log = require("./../util/LogService");
var Sequelize = require('sequelize');
var dbConfig = require("../../config/database.json");
var _ = require("lodash");

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
            dbMigrate.internals.argv.count = undefined; // HACK: Fix db-migrate from using `config/config.yaml` as the count. See https://github.com/turt2live/matrix-appservice-instagram/issues/11
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
        this.__BotAccountData = this._orm.import(__dirname + "/models/bot_account_data");

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
                profileExpires: Sequelize.literal("CURRENT_TIMESTAMP"),
                mediaExpirationTime: Sequelize.literal("CURRENT_TIMESTAMP"),
                isDelisted: false
            });
            else return user;
        }).then(u => new User(u));
    }

    /**
     * Gets an Instagram user from their account ID
     * @param {string} accountId the account ID to lookup
     * @return {Promise<User>} resolves to the found user, or null if not found
     */
    findUserByAccountId(accountId) {
        return this.__Users.find({where: {accountId: accountId}}).then(user => user ? new User(user) : null);
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

    /**
     * Gets the account data for the bridge bot
     * @returns {Promise<*>} a json object representing the key/value pairs
     */
    getBotAccountData() {
        return this.__BotAccountData.findAll().then(rows => {
            var container = {};
            for (var row of rows) {
                container[row.key] = row.value;
            }
            return container;
        });
    }

    /**
     * Saves the bridge bot's account data. Takes the value verbatim, expecting a string.
     * @param {*} data the data to save
     * @returns {Promise<>} resolves when complete
     */
    setBotAccountData(data) {
        return this.__BotAccountData.destroy({where: {}, truncate: true}).then(() => {
            var promises = [];

            var keys = _.keys(data);
            for (var key of keys) {
                promises.push(this.__BotAccountData.create({key: key, value: data[key]}));
            }

            return Promise.all(promises);
        });
    }

    /**
     * Gets all of the Instargram accounts the given matrix user has authorized
     * @param {string} mxId the matrix user ID to check for
     * @returns {Promise<User[]>} resolves to an array of Users the matrix user has authorized
     */
    getAuthorizedAccounts(mxId) {
        return this.__UserOAuthTokens.findAll({
            include: [{
                model: this.__Users,
                as: 'user'
            }],
            where: {
                mxId: mxId
            }
        }).then(results => (results || []).map(u => new User(u.user)));
    }

    /**
     * Flags a user as delisted
     * @param {number} userId the user ID to flag
     * @param {boolean} delisted whether or not the user is delisted
     * @returns {Promise<>} resolves when complete
     */
    flagDelisted(userId, delisted) {
        return this.__Users.findById(userId).then(user => {
            if (user.isDelisted === delisted) return Promise.resolve();
            user.isDelisted = delisted;
            return user.save();
        });
    }

    /**
     * Gets all the media posted by the bridge user
     * @param {number} userId the bridge user ID to lookup
     * @returns {Promise<MediaEvent[]>} resolves to an array of MediaEvents for that user, if any
     */
    getMediaEvents(userId) {
        return this.__UserMedia.findAll({where: {userId: userId}}).then(events => (events || []).map(e => new MediaEvent(e)));
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
 * Converts a database value to a boolean
 * @param {*} val the value from the database
 * @return {boolean} the boolean
 */
function dbToBool(val) {
    return val === 1 || val === true;
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
        this.isDelisted = dbToBool(dbFields.isDelisted);
    }
}

/**
 * Represents a Media Event from the database.
 */
class MediaEvent {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.userId = dbFields.userId;
        this.mediaId = dbFields.mediaId;
        this.mxEventId = dbFields.mxEventId;
        this.mxRoomId = dbFields.mxRoomId;
    }
}

module.exports = new InstagramStore();